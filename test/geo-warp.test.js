import test from 'node:test'
import assert from 'node:assert/strict'
import { geoEquirectangular } from 'd3-geo'

import {
  buildColorLut,
  computeDomain,
  lonLatToMercator,
  makeInverseGeoTransform,
  paintRaster,
  sampleBilinear,
  sampleNearest,
} from '../src/viz-runtime/raster-paint.js'
import { geoWarp } from '../src/viz-runtime/geo-warp.js'

// 4×2 の世界ラスタ（左上が北西）。値は 0..7。
const WORLD = { width: 4, height: 2, bbox: [-180, -90, 180, 90], nodata: -1, crs: 'EPSG:4326' }
const BAND = Float32Array.from([0, 1, 2, 3, 4, 5, 6, 7])

test('sampleNearest / sampleBilinear は範囲外と nodata を null にする', () => {
  assert.equal(sampleNearest(BAND, 4, 2, 0.5, 0.5, -1), 0)
  assert.equal(sampleNearest(BAND, 4, 2, 3.9, 1.9, -1), 7)
  assert.equal(sampleNearest(BAND, 4, 2, -0.1, 0.5, -1), null)
  assert.equal(sampleNearest(Float32Array.from([-1, 2, 3, 4]), 2, 2, 0.5, 0.5, -1), null)
  // ピクセル中心は元の値、中間は平均
  assert.equal(sampleBilinear(BAND, 4, 2, 0.5, 0.5, -1), 0)
  assert.equal(sampleBilinear(BAND, 4, 2, 1.0, 0.5, -1), 0.5)
  // nodata の近傍は重みから外れる
  assert.equal(sampleBilinear(Float32Array.from([-1, 2, 2, 2]), 2, 2, 1.0, 1.0, -1), 2)
  assert.equal(sampleBilinear(Float32Array.from([-1, -1, -1, -1]), 2, 2, 1.0, 1.0, -1), null)
})

test('makeInverseGeoTransform は CRS 座標をピクセル座標（左上原点）にする', () => {
  const inv = makeInverseGeoTransform(WORLD)
  assert.deepEqual(inv(-180, 90), [0, 0])
  assert.deepEqual(inv(180, -90), [4, 2])
  assert.deepEqual(inv(0, 0), [2, 1])
})

test('lonLatToMercator は原点で 0、緯度は ±85 で丸める', () => {
  const [x0, y0] = lonLatToMercator(0, 0)
  assert.ok(Math.abs(x0) < 1e-6 && Math.abs(y0) < 1e-6)
  const [x] = lonLatToMercator(180, 0)
  assert.ok(Math.abs(x - 20037508.34) < 1)
  const [, yMax] = lonLatToMercator(0, 89)
  const [, yClamp] = lonLatToMercator(0, 85.05112878)
  assert.equal(yMax, yClamp)
})

test('computeDomain と buildColorLut', () => {
  assert.deepEqual(computeDomain(Float32Array.from([3, -1, 5, NaN]), -1), [3, 5])
  assert.deepEqual(computeDomain(Float32Array.from([-1, -1]), -1), [0, 1])
  const lut = buildColorLut({ color: (v) => [v, 0, 0], domain: [0, 255], steps: 256 })
  assert.deepEqual(lut(0), [0, 0, 0, 255])
  assert.deepEqual(lut(255), [255, 0, 0, 255])
  assert.deepEqual(lut(1000), [255, 0, 0, 255])
})

test('paintRaster は恒等 invert で元ラスタを写す', () => {
  const out = new Uint8ClampedArray(4 * 2 * 4)
  const stats = paintRaster({
    width: 4,
    height: 2,
    // 出力ピクセル (x, y) → 経緯度（出力と入力が同じ格子）
    invert: (x, y) => [-180 + (x / 4) * 360, 90 - (y / 2) * 180],
    raster: WORLD,
    band: BAND,
    color: (v) => [v * 10, 0, 0, 255],
    nodata: -1,
    out,
  })
  assert.deepEqual(stats, { painted: 8, total: 8 })
  assert.equal(out[0], 0)
  assert.equal(out[(1 * 4 + 3) * 4], 70)
})

test('geoWarp: 正距円筒に fitSize したラスタをそのまま再現し、球の外は透明', () => {
  const projection = geoEquirectangular().fitSize([4, 2], { type: 'Sphere' })
  const result = geoWarp().raster({ ...WORLD, bands: [BAND] }).projection(projection).size([4, 2]).toImageData()
  assert.equal(result.width, 4)
  assert.equal(result.height, 2)
  assert.deepEqual(result.domain, [0, 7])
  assert.equal(result.stats.painted, 8)
  // グレースケール既定: 最小値は黒、最大値は白
  assert.equal(result.data[0], 0)
  assert.equal(result.data[3], 255)
  assert.equal(result.data[7 * 4], 255)
})

test('geoWarp: CSS 文字列の色関数・nodata の透明・domain 指定', () => {
  const projection = geoEquirectangular().fitSize([4, 2], { type: 'Sphere' })
  const band = Float32Array.from([-1, 1, 2, 3, 4, 5, 6, 7])
  const result = geoWarp()
    .raster({ ...WORLD, bands: [band] })
    .projection(projection)
    .size([4, 2])
    .domain([0, 10])
    .color((v) => (v > 5 ? 'rgb(255, 0, 0)' : '#0000ff'))
    .interpolation('bilinear')
    .toImageData()
  assert.equal(result.data[3], 0, 'nodata は透明')
  assert.deepEqual(Array.from(result.data.slice(4, 8)), [0, 0, 255, 255])
  assert.deepEqual(Array.from(result.data.slice(7 * 4, 7 * 4 + 4)), [255, 0, 0, 255])
})

test('geoWarp: invert の無い投影・不正なバンドは日本語のエラー', () => {
  const noInvert = () => [0, 0]
  assert.throws(() => geoWarp().raster({ ...WORLD, bands: [BAND] }).projection(noInvert).toImageData(), /invert/)
  const projection = geoEquirectangular()
  assert.throws(() => geoWarp().raster({ ...WORLD, bands: [Float32Array.from([1])] }).projection(projection).toImageData(), /バンドが不正/)
  assert.throws(() => geoWarp().projection(projection).toImageData(), /raster/)
})
