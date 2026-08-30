// ラスタを出力ピクセル空間へ逆引きで塗る純粋部分（DOM 非依存）。
//
// 役割: 出力の各ピクセル → projection.invert → 経緯度 → ラスタ CRS → ラスタのピクセル座標 → 値 → 色、という
//       output-driven（backward mapping）ループ。前方投影だと穴が空くので必ず逆引きする
//       （reference/d3_raster_visualization_geoexamples_guide.md §5）。連続値は bilinear、カテゴリ値は nearest。
// 関係: geo-warp.js が d3 の投影・マスクと組み合わせて呼ぶ。Uint8ClampedArray に書くだけなので node --test で検証できる。
// 流用元: reference/d3_raster_reprojection_in_d3/d3-geo-warp.js の考え方（実装は Float32Array 入力・LUT・nodata 対応で書き直し）

const EARTH_RADIUS = 6378137
const MAX_MERCATOR_LAT = 85.05112878

// 値が nodata / 非数なら null。
function validValue(v, nodata) {
  if (v == null || Number.isNaN(v)) return null
  if (nodata != null && v === nodata) return null
  return v
}

// 最近傍サンプリング。px / py はラスタのピクセル座標（左上原点・連続値。0 ≤ px < width）。
export function sampleNearest(band, width, height, px, py, nodata) {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) return null
  return validValue(band[iy * width + ix], nodata)
}

// 双一次補間。nodata の近傍は重みから外し、有効な近傍が無ければ null。
export function sampleBilinear(band, width, height, px, py, nodata) {
  const fx = px - 0.5
  const fy = py - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  let sum = 0
  let weight = 0
  for (let j = 0; j <= 1; j += 1) {
    const y = Math.min(height - 1, Math.max(0, y0 + j))
    const wy = j === 0 ? 1 - ty : ty
    for (let i = 0; i <= 1; i += 1) {
      const x = Math.min(width - 1, Math.max(0, x0 + i))
      const wx = i === 0 ? 1 - tx : tx
      const w = wx * wy
      if (w <= 0) continue
      const v = validValue(band[y * width + x], nodata)
      if (v == null) continue
      sum += v * w
      weight += w
    }
  }
  if (weight <= 0) return null
  return sum / weight
}

// 経緯度 → Web メルカトル（EPSG:3857、メートル）。
export function lonLatToMercator(lon, lat) {
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat))
  const x = (lon * Math.PI * EARTH_RADIUS) / 180
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 360))
  return [x, y]
}

// ラスタ CRS の座標 → ピクセル座標（左上原点）。bbox は [west, south, east, north]（CRS の単位）。
export function makeInverseGeoTransform({ width, height, bbox }) {
  const [west, south, east, north] = bbox
  const dx = (east - west) / width
  const dy = (north - south) / height
  return (x, y) => [(x - west) / dx, (north - y) / dy]
}

// 有効値の [min, max]。全て無効なら [0, 1]。
export function computeDomain(band, nodata) {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < band.length; i += 1) {
    const v = validValue(band[i], nodata)
    if (v == null) continue
    if (v < min) min = v
    if (v > max) max = v
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  if (min === max) return [min, min + 1]
  return [min, max]
}

// 値 → RGBA 配列を steps 段階で事前計算した LUT。color(value) は [r, g, b, a?] を返す関数。
export function buildColorLut({ color, domain, steps = 256 }) {
  const [min, max] = domain
  const span = max - min || 1
  const table = new Array(steps)
  for (let i = 0; i < steps; i += 1) {
    const value = min + (span * i) / (steps - 1)
    table[i] = toRgba(color(value))
  }
  return (value) => {
    const t = (value - min) / span
    const index = Math.round(Math.min(1, Math.max(0, t)) * (steps - 1))
    return table[index]
  }
}

// [r, g, b] / [r, g, b, a] を 4 要素に正規化。null は透明扱い。
export function toRgba(c) {
  if (!c) return null
  return [c[0], c[1], c[2], c.length > 3 && c[3] != null ? c[3] : 255]
}

// 出力ピクセルを逆引きで塗る。
//   width / height: 出力サイズ
//   invert(x, y): 出力ピクセル中心 → [lon, lat]（範囲外は null）
//   raster: { width, height, bbox }（bbox はラスタ CRS の単位）
//   band: Float32Array 等（長さ raster.width * raster.height）
//   toSource(lon, lat): 経緯度 → ラスタ CRS 座標（省略時は経緯度そのまま）
//   interpolation: 'nearest' | 'bilinear'
//   color(value): [r, g, b, a?]（LUT 化済みを渡すのが望ましい）
//   mask(lon, lat): true のときだけ塗る（省略可）
//   nodata: 無効値
//   out: Uint8ClampedArray（長さ width * height * 4）
// 戻り値: { painted, total }
export function paintRaster({ width, height, invert, raster, band, toSource, interpolation = 'nearest', color, mask, nodata, out }) {
  const inverse = makeInverseGeoTransform(raster)
  const sample = interpolation === 'bilinear' ? sampleBilinear : sampleNearest
  let painted = 0
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const lonlat = invert(col + 0.5, row + 0.5)
      if (!lonlat) continue
      if (mask && !mask(lonlat[0], lonlat[1])) continue
      const src = toSource ? toSource(lonlat[0], lonlat[1]) : lonlat
      if (!src) continue
      const [px, py] = inverse(src[0], src[1])
      if (px < 0 || py < 0 || px >= raster.width || py >= raster.height) continue
      const value = sample(band, raster.width, raster.height, px, py, nodata)
      if (value == null) continue
      const rgba = color(value)
      if (!rgba) continue
      const o = (row * width + col) * 4
      out[o] = rgba[0]
      out[o + 1] = rgba[1]
      out[o + 2] = rgba[2]
      out[o + 3] = rgba[3]
      painted += 1
    }
  }
  return { painted, total: width * height }
}
