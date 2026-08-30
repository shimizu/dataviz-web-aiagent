import test from 'node:test'
import assert from 'node:assert/strict'

import { detectDelimiter, inferColumnType, parseDelimitedText, parseNumber, profileColumn } from '../src/data/parsers/tabular.js'
import { buildDiagnostics, inspectFeatureCollection, parseGeoJson, ringSignedArea, toFeatureCollection } from '../src/data/parsers/geojson.js'
import { bandStats, checkCompression, detectCrs, fitRasterSize, parseGeoTiff } from '../src/data/parsers/geotiff.js'
import { detectFileKind, importFile } from '../src/data/import-files.js'

// --- tabular ---

test('parseNumber は桁区切り・通貨・% を数値として読む', () => {
  assert.equal(parseNumber('1,234'), 1234)
  assert.equal(parseNumber(' -12.5 '), -12.5)
  assert.equal(parseNumber('45%'), 45)
  assert.equal(parseNumber('1e3'), 1000)
  assert.equal(parseNumber('12月'), null)
  assert.equal(parseNumber(''), null)
})

test('inferColumnType は number / date / boolean / string を見分ける', () => {
  assert.equal(inferColumnType(['1', '2', '3.5']), 'number')
  assert.equal(inferColumnType(['2026-01-01', '2026-02-01', '']), 'date')
  assert.equal(inferColumnType(['2026/1/1', '2026/2/1']), 'date')
  assert.equal(inferColumnType(['true', 'false', 'yes']), 'boolean')
  assert.equal(inferColumnType(['0', '1', '1']), 'number', '0/1 は数値として扱う')
  assert.equal(inferColumnType(['東京', '大阪']), 'string')
  assert.equal(inferColumnType(['', '']), 'string')
})

test('detectDelimiter は拡張子と中身から区切りを決める', () => {
  assert.equal(detectDelimiter('a,b\n1,2', 'x.csv'), ',')
  assert.equal(detectDelimiter('a,b\n1,2', 'x.tsv'), '\t')
  assert.equal(detectDelimiter('a\tb\n1\t2', 'x.txt'), '\t')
  assert.equal(detectDelimiter('a,b\n1,2', 'x.txt'), ',')
})

test('parseDelimitedText は型を推定し、number/boolean だけ変換して date は文字列のまま残す', () => {
  const text = '都市,人口,日付,有効\n東京,1,2026-01-01,true\n大阪,,2026-02-01,false\n'
  const out = parseDelimitedText(text, { fileName: 'a.csv' })
  assert.equal(out.rowCount, 2)
  assert.deepEqual(out.columns.map((c) => `${c.name}:${c.type}`), ['都市:string', '人口:number', '日付:date', '有効:boolean'])
  assert.deepEqual(out.records[0], { 都市: '東京', 人口: 1, 日付: '2026-01-01', 有効: true })
  assert.equal(out.records[1].人口, null, '欠損は null')
  const population = out.columns.find((c) => c.name === '人口')
  assert.equal(population.nullCount, 1)
  assert.equal(population.min, 1)
  const city = out.columns.find((c) => c.name === '都市')
  assert.equal(city.uniqueCount, 2)
  assert.deepEqual(city.topValues[0], { value: '東京', count: 1 })
})

test('parseDelimitedText は引用符付き CSV を扱い、空の列名に仮の名前を付ける（new Function を使わない経路）', () => {
  const text = 'name,,memo\n"山田, 太郎",5,"改行\nあり"\n'
  const out = parseDelimitedText(text, { fileName: 'a.csv' })
  assert.deepEqual(out.columns.map((c) => c.name), ['name', '列2', 'memo'])
  assert.equal(out.records[0].name, '山田, 太郎')
  assert.equal(out.records[0].memo, '改行\nあり')
  assert.match(out.warnings.join(''), /列名が空だった列/)
})

test('parseDelimitedText は行数上限で切り、警告を返す。空ファイルは日本語エラー', () => {
  const text = ['a', ...Array.from({ length: 10 }, (_, i) => String(i))].join('\n')
  const out = parseDelimitedText(text, { fileName: 'a.csv', maxRows: 3 })
  assert.equal(out.rowCount, 3)
  assert.equal(out.truncated, true)
  assert.match(out.warnings[0], /先頭 3 行/)
  assert.throws(() => parseDelimitedText('   ', { fileName: 'a.csv' }), /空です/)
})

test('profileColumn は数値の min/max/mean と文字列の頻度を返す', () => {
  const num = profileColumn('v', 'number', [1, 3, null, 5])
  assert.deepEqual([num.min, num.max, num.mean, num.nullCount], [1, 5, 3, 1])
  const str = profileColumn('k', 'string', ['a', 'b', 'a'])
  assert.equal(str.uniqueCount, 2)
  assert.deepEqual(str.topValues[0], { value: 'a', count: 2 })
})

// --- geojson ---

const SQUARE = (ring) => ({
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: { name: 'a', v: '3' }, geometry: { type: 'Polygon', coordinates: [ring] } }],
})
const CCW = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
const CW = [...CCW].reverse()

test('toFeatureCollection は Feature / Geometry / 配列を FeatureCollection に揃える', () => {
  assert.equal(toFeatureCollection({ type: 'Point', coordinates: [1, 2] }).features.length, 1)
  assert.equal(toFeatureCollection({ type: 'Feature', geometry: null, properties: {} }).features.length, 1)
  assert.equal(toFeatureCollection([{ type: 'Feature' }]).features.length, 1)
  assert.throws(() => toFeatureCollection({ type: 'Nope' }), /type が不正/)
  assert.throws(() => toFeatureCollection('x'), /オブジェクトではありません/)
})

test('ringSignedArea は反時計回りで正', () => {
  assert.ok(ringSignedArea(CCW) > 0)
  assert.ok(ringSignedArea(CW) < 0)
  assert.equal(ringSignedArea([[0, 0]]), 0)
})

test('inspectFeatureCollection は頂点・bbox・巻き方向・不正座標を数える', () => {
  const info = inspectFeatureCollection(SQUARE(CCW))
  assert.equal(info.vertexCount, 5)
  assert.deepEqual(info.bbox, [0, 0, 1, 1])
  assert.deepEqual(info.geometryTypes, ['Polygon'])
  assert.equal(info.clockwiseExterior, 0)
  assert.equal(inspectFeatureCollection(SQUARE(CW)).clockwiseExterior, 1)
  const broken = inspectFeatureCollection({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [NaN, 5] } }],
  })
  assert.equal(broken.invalidCount, 1)
})

test('buildDiagnostics は投影座標・巻き方向・日付変更線を指摘する', () => {
  const projected = buildDiagnostics({ outOf180: 4, latOver90: 4, invalidCount: 0, clockwiseExterior: 0, exteriorRings: 1, bbox: [1e6, 1e6, 2e6, 2e6] })
  assert.match(projected.join('\n'), /EPSG:3857/)
  const wound = buildDiagnostics({ outOf180: 0, latOver90: 0, invalidCount: 0, clockwiseExterior: 2, exteriorRings: 3, bbox: [-10, -10, 10, 10] })
  assert.match(wound.join('\n'), /turf\.rewind/)
  const dateline = buildDiagnostics({ outOf180: 0, latOver90: 0, invalidCount: 0, clockwiseExterior: 0, exteriorRings: 0, bbox: [-170, 0, 170, 10] })
  assert.match(dateline.join('\n'), /日付変更線/)
  const nan = buildDiagnostics({ outOf180: 0, latOver90: 0, invalidCount: 3, clockwiseExterior: 0, exteriorRings: 0, bbox: [0, 0, 1, 1] })
  assert.match(nan[0], /NaN/)
})

test('parseGeoJson は保存形を作り、座標は書き換えない', async () => {
  const ds = await parseGeoJson(JSON.stringify(SQUARE(CW)), { name: 'a.geojson' })
  assert.equal(ds.kind, 'geojson')
  assert.equal(ds.featureCount, 1)
  assert.equal(ds.displayFeatureCollection, null, '小さいので簡略版は作らない')
  assert.deepEqual(ds.featureCollection.features[0].geometry.coordinates[0], CW, '巻き方向は直さない（診断だけ）')
  assert.match(ds.diagnostics.join('\n'), /時計回り/)
  assert.deepEqual(ds.propertiesSchema.map((c) => `${c.name}:${c.type}`), ['name:string', 'v:number'])
  await assert.rejects(parseGeoJson(JSON.stringify({ type: 'FeatureCollection', features: [] })), /0 件/)
})

// --- geotiff ---

test('checkCompression は WASM が要る圧縮を日本語で拒否する', () => {
  assert.equal(checkCompression(5).ok, true)
  assert.equal(checkCompression(8).name, 'Deflate')
  const zstd = checkCompression(50000)
  assert.equal(zstd.ok, false)
  assert.match(zstd.message, /gdal_translate/)
  assert.equal(checkCompression(34887).ok, false, 'LERC')
})

test('detectCrs と fitRasterSize', () => {
  assert.equal(detectCrs({ GeographicTypeGeoKey: 4326 }), 'EPSG:4326')
  assert.equal(detectCrs({ ProjectedCSTypeGeoKey: 3857 }), 'EPSG:3857')
  assert.equal(detectCrs({ ProjectedCSTypeGeoKey: 32654 }), 'EPSG:32654')
  assert.equal(detectCrs({}), 'unknown')
  assert.deepEqual(fitRasterSize(100, 50, 2048), { width: 100, height: 50, scale: 1 })
  const fitted = fitRasterSize(4096, 2048, 2048)
  assert.deepEqual([fitted.width, fitted.height], [2048, 1024])
})

test('bandStats は nodata と非数を除く', () => {
  assert.deepEqual(bandStats(Float32Array.from([1, 2, 3, -9999]), -9999), { min: 1, max: 3, mean: 2, validCount: 3 })
  assert.deepEqual(bandStats(Float32Array.from([-9999]), -9999), { min: null, max: null, mean: null, validCount: 0 })
})

test('parseGeoTiff は間引き・Float32 化・統計を行う（偽 geotiff を注入）', async () => {
  const fakeImage = {
    fileDirectory: { Compression: 5 },
    geoKeys: { GeographicTypeGeoKey: 4326 },
    getWidth: () => 4096,
    getHeight: () => 2048,
    getSamplesPerPixel: () => 5,
    getBoundingBox: () => [-180, -90, 180, 90],
    getGDALNoData: () => -9999,
    getOrigin: () => [-180, 90],
    getResolution: () => [0.087890625, -0.087890625],
    readRasters: async ({ width, height, samples }) => samples.map(() => new Int16Array(width * height).fill(2)),
  }
  const ds = await parseGeoTiff(new ArrayBuffer(8), {
    name: 'a.tif',
    maxEdge: 64,
    fromArrayBuffer: async () => ({ getImage: async () => fakeImage }),
  })
  assert.deepEqual([ds.width, ds.height], [64, 32])
  assert.equal(ds.bandCount, 4, 'バンドは 4 本まで')
  assert.ok(ds.bands[0] instanceof Float32Array)
  assert.deepEqual(ds.stats[0], { min: 2, max: 2, mean: 2, validCount: 64 * 32 })
  assert.equal(ds.crs, 'EPSG:4326')
  assert.equal(ds.nodata, -9999)
  assert.match(ds.diagnostics.join('\n'), /間引き/)
  assert.match(ds.diagnostics.join('\n'), /先頭 4 本/)

  const zstd = { ...fakeImage, fileDirectory: { Compression: 50000 } }
  await assert.rejects(parseGeoTiff(new ArrayBuffer(8), { fromArrayBuffer: async () => ({ getImage: async () => zstd }) }), /ZSTD/)
})

// --- import-files ---

test('detectFileKind は拡張子と MIME から種別を決める', () => {
  assert.equal(detectFileKind('a.CSV'), 'tabular')
  assert.equal(detectFileKind('a.tsv'), 'tabular')
  assert.equal(detectFileKind('a.geojson'), 'geojson')
  assert.equal(detectFileKind('a.tif'), 'raster')
  assert.equal(detectFileKind('a.json'), 'json')
  assert.equal(detectFileKind('a.bin', 'image/tiff'), 'raster')
  assert.equal(detectFileKind('a.bin'), 'unknown')
})

const fakeFile = (name, content, type = '') => ({
  name,
  type,
  size: typeof content === 'string' ? content.length : content.byteLength,
  text: async () => content,
  arrayBuffer: async () => content,
})

test('importFile は csv / geojson を振り分け、非 GeoJSON の json と未対応形式を弾く', async () => {
  const csv = await importFile(fakeFile('a.csv', 'x,y\n1,2\n'))
  assert.equal(csv.dataset.kind, 'tabular')
  assert.equal(csv.dataset.rowCount, 1)
  assert.equal(csv.original.text, 'x,y\n1,2\n')

  const geo = await importFile(fakeFile('a.json', JSON.stringify(SQUARE(CCW))))
  assert.equal(geo.dataset.kind, 'geojson')

  await assert.rejects(importFile(fakeFile('a.json', '{"rows":[1,2]}')), /GeoJSON ではない/)
  await assert.rejects(importFile(fakeFile('a.bin', 'x')), /対応していない形式/)
  await assert.rejects(importFile({ ...fakeFile('big.tif', new ArrayBuffer(8)), size: 99 * 1024 * 1024 }), /上限/)
})
