import test from 'node:test'
import assert from 'node:assert/strict'

import { ToolRegistry } from '../src/agent/tool-registry.js'
import { datavizSource } from '../src/tools/dataviz/index.js'
import { analysisResultToDataset, capDescription } from '../src/tools/dataviz/dataset-handlers.js'
import { createDatasetStore } from '../src/data/dataset-store.js'
import { createAnalysisCache } from '../src/data/analysis-cache.js'
import { createRecordStore } from '../src/data/record-store.js'
import { describeDataset, formatDatasetList, summarizeDataset, toRuntimeDataset } from '../src/data/dataset-shapes.js'
import { makeJavascriptHandlers } from '../src/tools/javascript/handlers.js'

const TABULAR = {
  kind: 'tabular',
  name: 'sales.csv',
  columns: [
    { name: '都市', type: 'string', nullCount: 0, uniqueCount: 2, topValues: [{ value: '東京', count: 1 }] },
    { name: '売上', type: 'number', nullCount: 0, min: 1, max: 9, mean: 5 },
  ],
  records: [
    { 都市: '東京', 売上: 9 },
    { 都市: '大阪', 売上: 1 },
  ],
  rowCount: 2,
}
const GEO = {
  kind: 'geojson',
  name: 'pref.geojson',
  featureCollection: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { p: 1 }, geometry: { type: 'Point', coordinates: [1, 2] } }] },
  displayFeatureCollection: null,
  featureCount: 1,
  geometryTypes: ['Point'],
  bbox: [1, 2, 1, 2],
  vertexCount: 1,
  propertiesSchema: [{ name: 'p', type: 'number' }],
  diagnostics: ['外周リングが時計回り'],
}
const RASTER = {
  kind: 'raster',
  name: 'dem.tif',
  width: 4,
  height: 2,
  originalWidth: 8,
  originalHeight: 4,
  bbox: [-180, -90, 180, 90],
  crs: 'EPSG:4326',
  nodata: -9999,
  bandCount: 1,
  bands: [Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8])],
  stats: [{ min: 1, max: 8, mean: 4.5, validCount: 8 }],
  geoTransform: [-180, 45, 0, 90, 0, -45],
}

// メモリのみのストア（IndexedDB を使わない）。
const memoryStore = () => createDatasetStore({ persist: false })
const hydrated = async (store) => {
  await store.hydrate()
  return store
}

// --- dataset-shapes ---

test('toRuntimeDataset は種別ごとに records / geojson / raster を揃え、metadata にも本体を入れる', () => {
  const tab = toRuntimeDataset({ ...TABULAR, id: 'ds_001' })
  assert.deepEqual(tab.columns, [{ name: '都市', type: 'string' }, { name: '売上', type: 'number' }])
  assert.equal(tab.records.length, 2)
  assert.equal(tab.metadata.rowCount, 2)
  assert.equal(tab.geojson, null)

  const geo = toRuntimeDataset({ ...GEO, id: 'ds_002' })
  assert.equal(geo.records.length, 1, 'geojson の records は features')
  assert.equal(geo.geojson, geo.metadata.geojson, 'Worker 側から metadata 経由でも読める')
  assert.deepEqual(geo.metadata.geometryTypes, ['Point'])

  const ras = toRuntimeDataset({ ...RASTER, id: 'ds_003' })
  assert.deepEqual(ras.records, [])
  assert.equal(ras.raster.bands[0].length, 8)
  assert.equal(ras.metadata.raster, ras.raster)
  assert.equal(toRuntimeDataset(null), null)
})

test('toRuntimeDataset は簡略版があればそちらを描画用に渡す', () => {
  const simplified = { type: 'FeatureCollection', features: [] }
  const runtime = toRuntimeDataset({ ...GEO, id: 'ds_002', displayFeatureCollection: simplified })
  assert.equal(runtime.geojson, simplified)
  assert.equal(runtime.metadata.simplified, true)
})

test('summarizeDataset / formatDatasetList は種別ごとの 1 行要約を作る', () => {
  assert.deepEqual(summarizeDataset({ ...TABULAR, id: 'ds_001' }), {
    id: 'ds_001',
    name: 'sales.csv',
    kind: 'tabular',
    rowCount: 2,
    columns: ['都市:string', '売上:number'],
  })
  assert.equal(summarizeDataset({ ...RASTER, id: 'ds_003' }).size, '4×2')
  const text = formatDatasetList([{ ...TABULAR, id: 'ds_001' }, { ...GEO, id: 'ds_002' }, { ...RASTER, id: 'ds_003' }])
  assert.match(text, /## 読み込み済みデータセット/)
  assert.match(text, /ds_001: sales\.csv（表・2 行 × 2 列）/)
  assert.match(text, /ds_002: pref\.geojson（GeoJSON・1 地物・Point）/)
  assert.equal(formatDatasetList([]), '', '空なら揮発ブロックに何も出さない')
})

test('describeDataset は種別ごとの要約とサンプルを返す（全行は返さない）', () => {
  const tab = describeDataset({ ...TABULAR, id: 'ds_001' }, { sample: 1 })
  assert.equal(tab.sample.length, 1)
  assert.equal(tab.columns[1].mean, 5)
  const noStats = describeDataset({ ...TABULAR, id: 'ds_001' }, { sample: 0, stats: false })
  assert.deepEqual(noStats.sample, [])
  assert.deepEqual(noStats.columns[0], { name: '都市', type: 'string' })

  const geo = describeDataset({ ...GEO, id: 'ds_002' }, { sample: 5 })
  assert.deepEqual(geo.sampleProperties, [{ p: 1 }])
  assert.deepEqual(geo.diagnostics, ['外周リングが時計回り'])

  const ras = describeDataset({ ...RASTER, id: 'ds_003' })
  assert.equal(ras.downsampled, true)
  assert.equal(ras.originalSize, '8×4')
  assert.equal(ras.bands[0].max, 8)
})

// --- record-store ---

test('createRecordStore は連番 ID・購読通知・更新・削除・全消去を行う', async () => {
  const store = createRecordStore({ storeName: 'datasets', idPrefix: 'ds', persist: false })
  let notified = 0
  store.subscribe(() => {
    notified += 1
  })
  await store.hydrate()
  assert.equal(store.isHydrated(), true)
  const a = store.add({ name: 'a' })
  const b = store.add({ name: 'b' })
  assert.deepEqual([a.id, b.id], ['ds_001', 'ds_002'])
  assert.ok(a.createdAt)
  assert.equal(store.get('ds_002').name, 'b')
  const snapshot = store.getSnapshot()
  store.update('ds_001', { name: 'a2' })
  assert.notEqual(store.getSnapshot(), snapshot, '変更のたびに新しい配列')
  assert.equal(store.get('ds_001').name, 'a2')
  assert.equal(store.remove('ds_999'), false)
  assert.equal(store.remove('ds_001'), true)
  store.clear()
  assert.deepEqual(store.getSnapshot(), [])
  assert.ok(notified >= 5)
})

test('createRecordStore は IndexedDB から復元し、書き込みを永続層へ流す', async () => {
  const calls = []
  const db = {
    getAll: async () => [{ id: 'ds_002', name: 'b' }, { id: 'ds_001', name: 'a' }],
    put: async (...args) => calls.push(['put', ...args]),
    remove: async (...args) => calls.push(['remove', ...args]),
    clear: async (...args) => calls.push(['clear', ...args]),
  }
  const store = createRecordStore({ storeName: 'datasets', idPrefix: 'ds', db })
  await store.hydrate()
  assert.deepEqual(store.getSnapshot().map((d) => d.id), ['ds_001', 'ds_002'], 'ID 順に並べ直す')
  assert.equal(store.nextId(), 'ds_003')
  store.add({ name: 'c' })
  store.remove('ds_001')
  store.clear()
  assert.deepEqual(calls.map((c) => c[0]), ['put', 'remove', 'clear'])
  assert.equal(calls[0][1], 'datasets')
})

// --- ツール ---

const registerDataviz = (deps) => {
  const registry = new ToolRegistry()
  datavizSource.register(registry, deps)
  return registry
}

test('dataviz ソースはデータセット系 3 ツールを含み、進め方スキルを先頭に持つ', () => {
  const registry = registerDataviz({ datasetStore: memoryStore() })
  const names = registry.definitions().map((d) => d.name)
  for (const name of ['describe_dataset', 'list_datasets', 'save_dataset']) assert.ok(names.includes(name), name)
  assert.ok(datavizSource.skills[0].startsWith('# スキル: データ可視化の進め方'))
})

test('list_datasets は空のとき案内を返し、読み込み後は要約を返す', async () => {
  const store = await hydrated(memoryStore())
  const registry = registerDataviz({ datasetStore: store })
  const empty = await registry.execute('list_datasets', {})
  assert.deepEqual(empty.datasets, [])
  assert.match(empty.note, /データ」タブ/)

  store.add(TABULAR)
  const listed = await registry.execute('list_datasets', {})
  assert.equal(listed.count, 1)
  assert.equal(listed.datasets[0].id, 'ds_001')
})

test('describe_dataset は不明な ID と復元前を分かりやすいエラーにする', async () => {
  const store = memoryStore()
  const registry = registerDataviz({ datasetStore: store })
  await assert.rejects(registry.execute('describe_dataset', { id: 'ds_001' }), /読み込み中/)
  await store.hydrate()
  await assert.rejects(registry.execute('describe_dataset', { id: 'ds_001' }), /まだ何も読み込まれていません/)
  store.add(TABULAR)
  await assert.rejects(registry.execute('describe_dataset', { id: 'ds_999' }), /利用できるのは ds_001/)
  await assert.rejects(registry.execute('describe_dataset', { id: '  ' }), /id が空です/)
  const out = await registry.execute('describe_dataset', { id: 'ds_001', sample: 1 })
  assert.equal(out.id, 'ds_001')
  assert.equal(out.sample.length, 1)
})

test('capDescription は 8000 文字の打ち切り前に自分で絞り、何を削ったか示す', () => {
  const big = {
    id: 'ds_001',
    kind: 'tabular',
    columns: Array.from({ length: 60 }, (_, i) => ({ name: `col${i}`, type: 'string', topValues: Array.from({ length: 5 }, (_, j) => ({ value: 'x'.repeat(40), count: j })) })),
    sample: Array.from({ length: 20 }, () => ({ text: 'y'.repeat(300) })),
  }
  const small = capDescription({ id: 'ds_001', sample: [{ a: 1 }] })
  assert.equal(small.truncated, undefined, '小さければそのまま')
  const capped = capDescription(big)
  assert.ok(JSON.stringify(capped).length <= 7000)
  assert.ok(Array.isArray(capped.truncated) && capped.truncated.length > 0)
})

test('analysisResultToDataset は配列行とオブジェクト行の両方を records にする', () => {
  const fromArrays = analysisResultToDataset({ codeHash: 'ab', resultColumns: ['k', 'v'], rows: [['a', 1], ['b', 2]], datasetId: 'ds_001' }, '集計')
  assert.equal(fromArrays.rowCount, 2)
  assert.deepEqual(fromArrays.records[0], { k: 'a', v: 1 })
  assert.deepEqual(fromArrays.columns.map((c) => `${c.name}:${c.type}`), ['k:string', 'v:number'])
  assert.deepEqual(fromArrays.derivedFrom, { codeHash: 'ab', datasetIds: ['ds_001'] })

  const fromObjects = analysisResultToDataset({ codeHash: 'cd', resultColumns: [], rows: [{ x: 1 }, { x: 2 }] }, 'obj')
  assert.deepEqual(fromObjects.columns.map((c) => c.name), ['x'])
  assert.throws(() => analysisResultToDataset({ codeHash: 'e', rows: [] }, 'x'), /行がありません/)
})

test('save_dataset は execute_javascript の全行を派生データセットにする', async () => {
  const store = await hydrated(memoryStore())
  const cache = createAnalysisCache()
  const registry = registerDataviz({ datasetStore: store, getAnalysisResult: (h) => cache.get(h) })

  await assert.rejects(registry.execute('save_dataset', { name: 'x', codeHash: 'zz' }), /先に execute_javascript/)
  await assert.rejects(registry.execute('save_dataset', { name: ' ', codeHash: 'zz' }), /name が空/)

  cache.put({ codeHash: 'ab12', resultColumns: ['k', 'v'], rows: [['a', 1], ['b', 2], ['c', 3]], computedAt: 'now', datasetId: 'ds_000' })
  const saved = await registry.execute('save_dataset', { name: '都市別合計', codeHash: 'ab12' })
  assert.equal(saved.rowCount, 3, 'LLM に返ったのは 20 行までだが保存されるのは全行')
  assert.equal(store.get(saved.id).records.length, 3)
  assert.equal(store.get(saved.id).derivedFrom.codeHash, 'ab12')
})

test('分析キャッシュは新しい順に上限件数だけ保持する', () => {
  const cache = createAnalysisCache({ capacity: 2 })
  cache.put({ codeHash: 'a', rows: [[1]] })
  cache.put({ codeHash: 'b', rows: [[2]] })
  cache.put({ codeHash: 'c', rows: [[3]] })
  assert.deepEqual(cache.hashes(), ['c', 'b'])
  assert.equal(cache.get('a'), null)
  assert.equal(cache.latest().codeHash, 'c')
  cache.put({ codeHash: 'b', rows: [[9]] })
  assert.deepEqual(cache.hashes(), ['b', 'c'], '再実行で先頭へ')
  cache.clear()
  assert.deepEqual(cache.hashes(), [])
})

test('execute_javascript は成功時に全行を onAnalysisResult へ渡す', async () => {
  const received = []
  const handlers = makeJavascriptHandlers({
    onAnalysisResult: (r) => received.push(r),
    runCode: async () => ({ status: 'success', codeHash: 'h1', resultColumns: ['v'], rows: Array.from({ length: 25 }, (_, i) => [i]), warnings: [], durationMs: 1, computedAt: 't', sourceRecordCount: 0 }),
  })
  const out = await handlers.executeJavascript({ code: 'function analyze(){}' })
  assert.equal(out.rows.length, 20, 'LLM へは 20 行まで')
  assert.equal(out.rowCount, 25)
  assert.equal(received[0].rows.length, 25, 'アプリ側へは全行')

  // 失敗時は呼ばれない
  const failing = makeJavascriptHandlers({
    onAnalysisResult: (r) => received.push(r),
    runCode: async () => ({ status: 'error', codeHash: 'h2', error: 'boom' }),
  })
  await assert.rejects(failing.executeJavascript({ code: 'x' }), /boom/)
  assert.equal(received.length, 1)
})
