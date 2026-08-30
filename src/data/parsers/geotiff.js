// GeoTIFF の読み込み（表示用に間引き）と統計。
//
// 役割: geotiff.js を動的 import して、長辺が上限（既定 2048px）に収まるよう readRasters で間引いて読む。
//       バンドは Float32Array に揃え（structured clone で Worker / フレームへそのまま渡せる）、
//       CRS・nodata・geoTransform・バンド統計を添える。純粋な部分（CRS 判定・圧縮判定・統計）は個別に export してテストする。
// 関係: import-files.js が呼ぶ。描画側は geoWarp（src/viz-runtime/geo-warp.js）で再投影する。
// 注意: 本番の CSP は script-src 'self'（'wasm-unsafe-eval' 無し）なので、WASM デコーダが要る圧縮は読めない。
//       先に fileDirectory.Compression を見て、読めないものは日本語のエラーにする。

export const MAX_RASTER_EDGE = 2048
export const MAX_BANDS = 4
export const MAX_GEOTIFF_BYTES = 50 * 1024 * 1024

// TIFF の Compression タグ → 対応可否。
const COMPRESSION_NAMES = {
  1: '無圧縮',
  5: 'LZW',
  6: 'JPEG(old)',
  7: 'JPEG',
  8: 'Deflate',
  32773: 'PackBits',
  32946: 'Deflate',
  34712: 'JPEG2000',
  34887: 'LERC',
  34925: 'LZMA',
  50000: 'ZSTD',
  50001: 'ZSTD',
}
// WASM が要るためブラウザの CSP（script-src 'self'）では読めない圧縮。
const UNSUPPORTED_COMPRESSIONS = new Set([34712, 34887, 34925, 50000, 50001])

export function checkCompression(code) {
  const name = COMPRESSION_NAMES[code] ?? `不明(${code})`
  if (code != null && UNSUPPORTED_COMPRESSIONS.has(Number(code))) {
    return {
      ok: false,
      name,
      message: `圧縮形式 ${name} は WASM デコーダが必要でこのアプリでは読めません。GDAL 等で LZW か Deflate に変換してください（例: gdal_translate -co COMPRESS=DEFLATE in.tif out.tif）`,
    }
  }
  return { ok: true, name }
}

// GeoKey から EPSG を判定する。
export function detectCrs(geoKeys = {}) {
  const projected = Number(geoKeys.ProjectedCSTypeGeoKey ?? 0)
  const geographic = Number(geoKeys.GeographicTypeGeoKey ?? 0)
  if (projected === 3857 || projected === 900913 || projected === 102100) return 'EPSG:3857'
  if (projected > 0) return `EPSG:${projected}`
  if (geographic === 4326 || geographic === 4269) return 'EPSG:4326'
  if (geographic > 0) return `EPSG:${geographic}`
  return 'unknown'
}

// 出力サイズ（長辺を maxEdge に収める。拡大はしない）。
export function fitRasterSize(width, height, maxEdge = MAX_RASTER_EDGE) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height, scale: 1 }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), scale }
}

// バンドの統計（nodata と NaN を除く）。
export function bandStats(band, nodata) {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let valid = 0
  for (let i = 0; i < band.length; i += 1) {
    const v = band[i]
    if (!Number.isFinite(v)) continue
    if (nodata != null && v === nodata) continue
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    valid += 1
  }
  if (valid === 0) return { min: null, max: null, mean: null, validCount: 0 }
  return { min, max, mean: Number((sum / valid).toFixed(6)), validCount: valid }
}

function toFloat32(values) {
  if (values instanceof Float32Array) return values
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i += 1) out[i] = Number(values[i])
  return out
}

// ArrayBuffer → 保存形。fromArrayBuffer はテストのために注入できる。
export async function parseGeoTiff(arrayBuffer, { name = '', maxEdge = MAX_RASTER_EDGE, fromArrayBuffer } = {}) {
  const open = fromArrayBuffer ?? (await import('geotiff')).fromArrayBuffer
  const tiff = await open(arrayBuffer)
  const image = await tiff.getImage()

  const compression = checkCompression(image.fileDirectory?.Compression)
  if (!compression.ok) throw new Error(compression.message)

  const originalWidth = image.getWidth()
  const originalHeight = image.getHeight()
  const target = fitRasterSize(originalWidth, originalHeight, maxEdge)
  const samples = Math.min(image.getSamplesPerPixel(), MAX_BANDS)
  const diagnostics = []
  if (image.getSamplesPerPixel() > MAX_BANDS) diagnostics.push(`バンドが ${image.getSamplesPerPixel()} 本あるので先頭 ${MAX_BANDS} 本だけ読み込みました`)
  if (target.scale < 1) diagnostics.push(`表示用に ${originalWidth}×${originalHeight} から ${target.width}×${target.height} へ間引きました（集計も間引き後の値を使います）`)

  const rasters = await image.readRasters({
    width: target.width,
    height: target.height,
    samples: Array.from({ length: samples }, (_, i) => i),
    resampleMethod: 'nearest',
    interleave: false,
  })
  const bands = Array.from({ length: samples }, (_, i) => toFloat32(rasters[i]))

  const nodataRaw = typeof image.getGDALNoData === 'function' ? image.getGDALNoData() : null
  const nodata = nodataRaw == null || Number.isNaN(Number(nodataRaw)) ? null : Number(nodataRaw)
  const bbox = image.getBoundingBox()
  const crs = detectCrs(image.geoKeys ?? {})
  if (crs !== 'EPSG:4326' && crs !== 'EPSG:3857') {
    diagnostics.push(`CRS が ${crs} です。このアプリが再投影できるのは EPSG:4326 と EPSG:3857 だけなので、経緯度として扱います（位置がずれる場合は事前に変換してください）`)
  }
  const origin = typeof image.getOrigin === 'function' ? image.getOrigin() : [bbox[0], bbox[3]]
  const resolution = typeof image.getResolution === 'function' ? image.getResolution() : [(bbox[2] - bbox[0]) / originalWidth, -(bbox[3] - bbox[1]) / originalHeight]

  return {
    kind: 'raster',
    name,
    width: target.width,
    height: target.height,
    originalWidth,
    originalHeight,
    bbox,
    crs,
    nodata,
    bandCount: bands.length,
    bands,
    stats: bands.map((b) => bandStats(b, nodata)),
    geoTransform: [origin[0], resolution[0], 0, origin[1], 0, resolution[1]],
    compression: compression.name,
    diagnostics,
  }
}
