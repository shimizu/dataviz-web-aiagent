import test from 'node:test'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { unzipSync, zip } from 'fflate'

import { normalizeSvgForExport, toFileName } from '../src/viz/svg-export.js'
import { buildZipFiles, createZipBlob, zipFileName } from '../src/viz/zip-export.js'
import { bytesToBase64, buildDatasetsScript, buildIndexHtml, buildReadme, buildStyleCss, buildVizScript, toSerializableDataset } from '../src/viz/zip-template.js'
import { toRuntimeDataset } from '../src/data/dataset-shapes.js'
import { VIZ_THEME } from '../src/viz/viz-theme.js'

const SVG = '<svg viewBox="0 0 100 50"><title>図</title><rect width="10" height="10"/></svg>'
const VIZ = { id: 'viz_001', title: '売上の推移', description: '月次売上', datasetIds: ['ds_001'] }
const VERSION = { version: 2, code: 'function render({ container }) { container.textContent = "x" }', svg: SVG, width: 100, height: 50, warnings: [] }

// --- svg-export ---

test('normalizeSvgForExport は XML 宣言・xmlns・サイズ・背景を補う', () => {
  const out = normalizeSvgForExport(SVG, { width: 100, height: 50 })
  assert.ok(out.startsWith('<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'))
  assert.match(out, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  assert.match(out, /width="100"/)
  assert.match(out, /height="50"/)
  assert.match(out, /<rect x="0" y="0" width="100" height="50" fill="#ffffff"\/><title>/, '背景を先頭に敷く')
  assert.match(out, /viewBox="0 0 100 50"/, '既にある属性は書き換えない')
})

test('normalizeSvgForExport は既存の xmlns を二重に付けず、declaration を切れる', () => {
  const withNs = '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"></svg>'
  const out = normalizeSvgForExport(withNs, { width: 100, height: 50, background: null, declaration: false })
  assert.equal(out.match(/xmlns=/g).length, 1)
  assert.match(out, /width="9"/, '既存のサイズを優先する')
  assert.doesNotMatch(out, /<\?xml/)
  assert.doesNotMatch(out, /<rect/)
  assert.throws(() => normalizeSvgForExport('   '), /SVG が空/)
  assert.throws(() => normalizeSvgForExport('<div></div>'), /SVG ではありません/)
})

test('toFileName は使えない文字を落として拡張子を付ける', () => {
  assert.equal(toFileName('売上/推移: 2026', 'svg'), '売上推移_2026.svg')
  assert.equal(toFileName('  ', 'png'), 'visualization.png')
  assert.equal(zipFileName('図'), '図.zip')
})

// --- zip-template ---

test('bytesToBase64 は 1〜3 バイトの端数を含めて正しく符号化する', () => {
  const decode = (s) => Buffer.from(s, 'base64')
  for (const bytes of [[], [0], [0, 255], [1, 2, 3], [1, 2, 3, 4], [72, 101, 108, 108, 111]]) {
    const encoded = bytesToBase64(Uint8Array.from(bytes))
    assert.deepEqual([...decode(encoded)], bytes, JSON.stringify(bytes))
  }
})

test('toSerializableDataset は種別ごとに本体だけを残し、二重化を避ける', () => {
  const tab = toSerializableDataset(toRuntimeDataset({ id: 'ds_001', kind: 'tabular', name: 'a', columns: [{ name: 'v', type: 'number' }], records: [{ v: 1 }], rowCount: 1 }))
  assert.deepEqual(tab.records, [{ v: 1 }])
  assert.equal(tab.metadata.geojson, undefined, 'metadata に本体を二重に入れない')

  const fc = { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: null }] }
  const geo = toSerializableDataset(toRuntimeDataset({ id: 'ds_002', kind: 'geojson', name: 'b', featureCollection: fc, featureCount: 1, geometryTypes: [], propertiesSchema: [] }))
  assert.deepEqual(geo.geojson, fc)
  assert.equal(geo.records, undefined, 'features は geojson から復元する')

  const ras = toSerializableDataset(toRuntimeDataset({ id: 'ds_003', kind: 'raster', name: 'c', width: 2, height: 1, bbox: [0, 0, 1, 1], bands: [Float32Array.from([1.5, -2])], bandCount: 1, stats: [] }))
  assert.equal(ras.raster.bands.length, 1)
  assert.equal(typeof ras.raster.bands[0].__f32, 'string')
  assert.equal(ras.records, undefined)
})

test('data/datasets.js は評価すると window.__DATASETS__ を復元する', () => {
  const datasets = [
    toRuntimeDataset({ id: 'ds_001', kind: 'tabular', name: 'a', columns: [{ name: 'v', type: 'number' }], records: [{ v: 1 }, { v: 2 }], rowCount: 2 }),
    toRuntimeDataset({
      id: 'ds_002',
      kind: 'geojson',
      name: 'b',
      featureCollection: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { p: 1 }, geometry: { type: 'Point', coordinates: [1, 2] } }] },
      featureCount: 1,
      geometryTypes: ['Point'],
      propertiesSchema: [],
    }),
    toRuntimeDataset({ id: 'ds_003', kind: 'raster', name: 'c', width: 2, height: 1, bbox: [0, 0, 1, 1], nodata: -1, bands: [Float32Array.from([1.5, -2])], bandCount: 1, stats: [] }),
  ]
  const source = buildDatasetsScript(datasets)
  // ブラウザの window / atob を用意して評価する
  const scope = {
    window: {},
    atob: (s) => {
      const buf = Buffer.from(s, 'base64')
      let out = ''
      for (const b of buf) out += String.fromCharCode(b)
      return out
    },
    Uint8Array,
    Float32Array,
  }
  const fn = new Function('window', 'atob', 'Uint8Array', 'Float32Array', source)
  fn(scope.window, scope.atob, Uint8Array, Float32Array)
  const out = scope.window.__DATASETS__

  assert.deepEqual(Object.keys(out), ['ds_001', 'ds_002', 'ds_003'])
  assert.deepEqual(out.ds_001.records, [{ v: 1 }, { v: 2 }])
  assert.equal(out.ds_002.records.length, 1, 'geojson の records は features から復元')
  assert.equal(out.ds_002.records[0].properties.p, 1)
  assert.equal(out.ds_002.metadata.geojson, out.ds_002.geojson, 'Worker 互換のため metadata にも入れ直す')
  assert.ok(out.ds_003.raster.bands[0] instanceof Float32Array)
  assert.deepEqual([...out.ds_003.raster.bands[0]], [1.5, -2])
  assert.equal(out.ds_003.raster.nodata, -1)
})

test('viz.js は render 関数と起動コードを含み、サイズと theme を埋め込む', () => {
  const source = buildVizScript({ code: VERSION.code, width: 800, height: 400, theme: VIZ_THEME })
  assert.match(source, /function render\(\{ container \}\)/)
  assert.match(source, /width: 800/)
  assert.match(source, /height: 400/)
  assert.match(source, /datasets: window\.__DATASETS__/)
  assert.match(source, /"primary":"#2563eb"/)
  assert.match(source, /DOMContentLoaded/, '読み込みが済む前でも動くようにする')
  const fallback = buildVizScript({ code: '', width: 0, height: null, theme: null })
  assert.match(fallback, /width: 960/)
  assert.match(fallback, /height: 600/)
})

test('index.html は classic script を 3 本読み、タイトルを HTML エスケープする', () => {
  const html = buildIndexHtml({ title: '<売上> & "推移"', description: 'a<b', generatedAt: '2026-01-01 00:00:00' })
  assert.match(html, /<title>&lt;売上&gt; &amp; &quot;推移&quot;<\/title>/)
  assert.match(html, /<figcaption>a&lt;b<\/figcaption>/)
  assert.match(html, /<script src="\.\/viz-runtime\.js"><\/script>/)
  assert.match(html, /<script src="\.\/data\/datasets\.js"><\/script>/)
  assert.match(html, /<script src="\.\/viz\.js"><\/script>/)
  assert.doesNotMatch(html, /type="module"/, 'file:// で読めるよう module にしない')
  assert.doesNotMatch(html, /https?:\/\//, 'CDN を参照しない')
  assert.doesNotMatch(buildIndexHtml({ title: 't', generatedAt: 'x' }), /figcaption/)
})

test('style.css と README.txt は theme とファイル一覧を反映する', () => {
  const css = buildStyleCss(VIZ_THEME)
  assert.match(css, /background: #ffffff/)
  assert.match(css, /max-width: 100%/)
  assert.match(buildStyleCss({}), /system-ui/, 'theme が無くても壊れない')
  const readme = buildReadme({ title: 'T', datasets: [{ id: 'ds_001', kind: 'tabular', name: 'a.csv' }], generatedAt: 'g', fileNames: ['index.html', 'viz.js'] })
  assert.match(readme, /index\.html をブラウザで開いて/)
  assert.match(readme, /- ds_001 \(tabular\): a\.csv/)
  assert.match(readme, /- viz\.js/)
  assert.match(buildReadme({ title: 'T', datasets: [], generatedAt: 'g', fileNames: [] }), /（なし）/)
})

// --- zip-export ---

test('buildZipFiles は必要なファイルを揃え、元データも同梱する', () => {
  const datasets = [toRuntimeDataset({ id: 'ds_001', kind: 'tabular', name: 'a.csv', columns: [], records: [{ v: 1 }], rowCount: 1 })]
  const originals = [
    { id: 'file_001', name: 'a.csv', text: 'v\n1\n' },
    { id: 'file_002', name: 'a.csv', buffer: new Uint8Array([1, 2, 3]).buffer },
    { id: 'file_003', name: 'skip.csv' },
    null,
  ]
  const files = buildZipFiles({ viz: VIZ, version: VERSION, datasets, originals, runtimeSource: '// runtime', theme: VIZ_THEME, now: new Date('2026-01-02T03:04:05Z') })
  assert.deepEqual(Object.keys(files).sort(), ['README.txt', 'data/a.csv', 'data/a_2.csv', 'data/datasets.js', 'index.html', 'style.css', 'viz-runtime.js', 'viz.js', 'viz.svg'])
  assert.equal(files['data/a.csv'], 'v\n1\n')
  assert.ok(files['data/a_2.csv'] instanceof Uint8Array, '重複名は連番、バイナリはそのまま')
  assert.match(files['viz.svg'], /^<\?xml/)
  assert.match(files['README.txt'], /2026-01-02 03:04:05/)
  assert.match(files['README.txt'], /- viz\.svg/)
  assert.equal(files['viz-runtime.js'], '// runtime')

  const noRuntime = buildZipFiles({ viz: VIZ, version: VERSION, datasets: [], runtimeSource: '' })
  assert.equal('viz-runtime.js' in noRuntime, false)
  assert.throws(() => buildZipFiles({ viz: null, version: null }), /書き出す可視化がありません/)
})

test('createZipBlob は fflate で圧縮し、展開すると同じ内容が戻る', async () => {
  const files = buildZipFiles({ viz: VIZ, version: VERSION, datasets: [], runtimeSource: '// r', theme: VIZ_THEME })
  const blob = await createZipBlob(files, { zipImpl: zip })
  assert.equal(blob.type, 'application/zip')
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const unzipped = unzipSync(bytes)
  assert.deepEqual(Object.keys(unzipped).sort(), Object.keys(files).sort())
  assert.equal(new TextDecoder().decode(unzipped['viz-runtime.js']), '// r')
  assert.match(new TextDecoder().decode(unzipped['index.html']), /売上の推移/)
})

test('createZipBlob は圧縮の失敗をそのまま伝える', async () => {
  await assert.rejects(createZipBlob({ 'a.txt': 'x' }, { zipImpl: (_f, _o, cb) => cb(new Error('boom')) }), /boom/)
})
