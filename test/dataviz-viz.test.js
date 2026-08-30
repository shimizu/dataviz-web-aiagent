import test from 'node:test'
import assert from 'node:assert/strict'

import { ToolRegistry } from '../src/agent/tool-registry.js'
import { datavizSource } from '../src/tools/dataviz/index.js'
import { formatRenderFailure, makeVisualizationHandlers, summarizeRender } from '../src/tools/dataviz/visualization-handlers.js'
import { MAX_VERSIONS, createVisualizationStore } from '../src/data/visualization-store.js'
import { createDatasetStore } from '../src/data/dataset-store.js'
import { DATAVIZ_WORKFLOW_SKILL } from '../src/agent/skills/dataviz-workflow.js'
import { DATAVIZ_CHARTS_SKILL } from '../src/agent/skills/dataviz-charts.js'
import { VIZ_THEME, describeTheme } from '../src/viz/viz-theme.js'

const TABULAR = { kind: 'tabular', name: 'a.csv', columns: [{ name: 'v', type: 'number' }], records: [{ v: 1 }], rowCount: 1 }

// 偽の可視化フレーム: 送られたものを記録し、code に 'FAIL' があれば失敗を返す。
function fakeBridge() {
  const calls = { put: [], render: [], clear: 0 }
  return {
    calls,
    async putDataset(ds) {
      calls.put.push(ds.id)
      return true
    },
    async render(req) {
      calls.render.push(req)
      if (req.code.includes('FAIL')) {
        return { ok: false, error: { message: 'x is not defined', stack: 'ReferenceError: x is not defined\n    at render (<anonymous>:3:5)\n    at other\n    at more' }, console: [{ level: 'log', text: 'before' }], warnings: [] }
      }
      return { ok: true, svg: `<svg>${req.code.length}</svg>`, warnings: req.code.includes('WARN') ? ['<title> がありません'] : [], console: [], stats: { elementCount: 3, durationMs: 4 }, width: req.width, height: req.height }
    },
    clear() {
      calls.clear += 1
    },
  }
}

async function setup() {
  const datasetStore = createDatasetStore({ persist: false })
  await datasetStore.hydrate()
  datasetStore.add(TABULAR)
  const visualizationStore = createVisualizationStore({ persist: false })
  await visualizationStore.hydrate()
  const vizBridge = fakeBridge()
  const posted = []
  const shown = []
  const registry = new ToolRegistry()
  datavizSource.register(registry, {
    datasetStore,
    visualizationStore,
    vizBridge,
    postChatMessage: (m) => posted.push(m),
    onVisualizationShown: (id) => shown.push(id),
    log: () => {},
  })
  return { datasetStore, visualizationStore, vizBridge, posted, shown, registry }
}

test('dataviz ソースは描画ツールを含む 6 ツールを登録する', async () => {
  const { registry } = await setup()
  assert.deepEqual(registry.definitions().map((d) => d.name).sort(), ['describe_dataset', 'list_datasets', 'read_reference', 'render_visualization', 'save_dataset', 'update_visualization'])
})

test('render_visualization はデータセットを送って描き、保存し、カードを投稿して要約を返す', async () => {
  const { registry, visualizationStore, vizBridge, posted, shown } = await setup()
  const out = await registry.execute('render_visualization', {
    title: '売上',
    code: 'function render(){}',
    datasetIds: ['ds_001', 'ds_001'],
    width: 800,
    height: 100,
    description: 'テスト',
  })
  assert.equal(out.vizId, 'viz_001')
  assert.equal(out.version, 1)
  assert.equal(out.ok, true)
  assert.equal(out.stats.elementCount, 3)
  assert.equal('svg' in out, false, 'SVG 本体は LLM に返さない')
  assert.deepEqual(vizBridge.calls.put, ['ds_001'], '重複 ID は 1 回だけ送る')
  assert.equal(vizBridge.calls.render[0].width, 800)
  assert.equal(vizBridge.calls.render[0].height, 320, '高さは最小値に丸める')
  assert.equal(vizBridge.calls.render[0].theme, VIZ_THEME)
  const saved = visualizationStore.get('viz_001')
  assert.equal(saved.title, '売上')
  assert.equal(saved.description, 'テスト')
  assert.deepEqual(saved.datasetIds, ['ds_001'])
  assert.equal(saved.versions[0].svg, '<svg>19</svg>')
  assert.deepEqual(posted[0], { kind: 'viz', vizId: 'viz_001', version: 1, title: '売上', label: '可視化' })
  assert.deepEqual(shown, ['viz_001'])
})

test('render_visualization の入力エラーは直し方が分かる日本語', async () => {
  const { registry } = await setup()
  await assert.rejects(registry.execute('render_visualization', { title: '', code: 'x', datasetIds: ['ds_001'] }), /title が空/)
  await assert.rejects(registry.execute('render_visualization', { title: 't', code: '  ', datasetIds: ['ds_001'] }), /code が空/)
  await assert.rejects(registry.execute('render_visualization', { title: 't', code: 'function render(){}', datasetIds: [] }), /datasetIds が空/)
  await assert.rejects(registry.execute('render_visualization', { title: 't', code: 'function render(){}', datasetIds: ['ds_999'] }), /ds_999.*ds_001/)
  await assert.rejects(registry.execute('render_visualization', { title: 't', code: 'fetch("http://x")', datasetIds: ['ds_001'] }), /使用できない参照.*fetch/)
})

test('描画失敗はエラー・スタック先頭・console をまとめて is_error にする', async () => {
  const { registry, visualizationStore } = await setup()
  await assert.rejects(registry.execute('render_visualization', { title: 't', code: 'FAIL', datasetIds: ['ds_001'] }), (err) => {
    assert.match(err.message, /描画に失敗しました: x is not defined/)
    assert.match(err.message, /--- スタック ---\nReferenceError/)
    assert.match(err.message, /--- console ---\n\[log\] before/)
    assert.doesNotMatch(err.message, /at more/, 'スタックは 3 行まで')
    return true
  })
  assert.equal(visualizationStore.getSnapshot().length, 0, '失敗は保存しない')
})

test('update_visualization は新バージョンを足し、サイズは前回を引き継ぐ', async () => {
  const { registry, visualizationStore, vizBridge, posted } = await setup()
  await registry.execute('render_visualization', { title: 't', code: 'function render(){ /* v1 */ }', datasetIds: ['ds_001'], width: 700, height: 500 })
  const out = await registry.execute('update_visualization', { vizId: 'viz_001', code: 'function render(){ /* v2 WARN */ }', changeNote: '色を変更', title: 't2' })
  assert.equal(out.version, 2)
  assert.deepEqual(out.warnings, ['<title> がありません'])
  assert.deepEqual(out.datasetIds, ['ds_001'])
  assert.equal(vizBridge.calls.render[1].width, 700)
  assert.equal(vizBridge.calls.render[1].height, 500)
  const viz = visualizationStore.get('viz_001')
  assert.equal(viz.title, 't2')
  assert.equal(viz.currentVersion, 2)
  assert.equal(viz.versions.length, 2)
  assert.equal(viz.versions[1].changeNote, '色を変更')
  assert.equal(posted.length, 2)
  await assert.rejects(registry.execute('update_visualization', { vizId: 'viz_999', code: 'x' }), /viz_999.*render_visualization/)
})

test('visualization-store はバージョン数の上限と選択を扱う', async () => {
  const store = createVisualizationStore({ persist: false })
  await store.hydrate()
  const viz = store.create({ title: 't', datasetIds: ['a'], code: 'c1', svg: 's1', width: 1, height: 1 })
  for (let i = 2; i <= MAX_VERSIONS + 3; i += 1) store.addVersion(viz.id, { code: `c${i}`, svg: `s${i}`, width: 1, height: 1 })
  const saved = store.get(viz.id)
  assert.equal(saved.versions.length, MAX_VERSIONS)
  assert.equal(saved.versions.at(-1).version, MAX_VERSIONS + 3)
  assert.equal(saved.currentVersion, MAX_VERSIONS + 3)
  store.selectVersion(viz.id, MAX_VERSIONS + 1)
  assert.equal(store.getVersion(viz.id).version, MAX_VERSIONS + 1, '選択中のバージョンを返す')
  assert.equal(store.getVersion(viz.id, 1), saved.versions.at(-1), '無いバージョンは最新にフォールバック')
  assert.equal(store.getVersion('nope'), null)
  assert.equal(store.addVersion('nope', { code: '' }), null)
})

test('summarizeRender / formatRenderFailure は console を末尾 10 件に絞る', () => {
  const logs = Array.from({ length: 15 }, (_, i) => ({ level: 'log', text: `l${i}` }))
  const summary = summarizeRender({ vizId: 'v', version: 1, title: 't', result: { warnings: ['w'], console: logs, stats: { a: 1 } } })
  assert.equal(summary.console.length, 10)
  assert.equal(summary.console[0], '[log] l5')
  const failure = formatRenderFailure({ error: { message: 'boom' }, console: logs })
  assert.match(failure, /描画に失敗しました: boom/)
  assert.doesNotMatch(failure, /\[log\] l4\b/)
  assert.match(formatRenderFailure({}), /不明なエラー/)
})

test('bridge が無いときは明示的なエラー', async () => {
  const h = makeVisualizationHandlers({ datasetStore: { getRuntime: () => ({ id: 'a' }), getSnapshot: () => [] }, visualizationStore: {} })
  await assert.rejects(h.renderVisualization({ title: 't', code: 'function render(){}', datasetIds: ['a'] }), /可視化フレームが利用できません/)
})

test('スキルは決定的で、render 契約と theme の表を含む', () => {
  assert.equal(DATAVIZ_WORKFLOW_SKILL, DATAVIZ_WORKFLOW_SKILL.trim())
  assert.ok(DATAVIZ_WORKFLOW_SKILL.startsWith('# スキル: データ可視化の進め方'))
  assert.ok(DATAVIZ_CHARTS_SKILL.startsWith('# スキル: チャートの作法'))
  assert.match(DATAVIZ_WORKFLOW_SKILL, /function render\(\{ container, d3, turf, geoWarp, datasets, width, height, theme \}\)/)
  assert.ok(DATAVIZ_WORKFLOW_SKILL.includes(describeTheme(VIZ_THEME)), 'theme の表は viz-theme.js から生成する')
  assert.match(DATAVIZ_WORKFLOW_SKILL, /`theme\.colors\.primary` \| `#2563eb`/)
  for (const skill of [DATAVIZ_WORKFLOW_SKILL, DATAVIZ_CHARTS_SKILL]) {
    assert.ok(!skill.includes(new Date().toISOString().slice(0, 10)), '現在日時などの揮発情報を含めない')
  }
})
