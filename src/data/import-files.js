// アップロードされたファイルの取り込み（判定 → パース → ストアへ）。
//
// 役割: File[] を拡張子と中身から csv/tsv / geojson / geotiff に振り分け、上限を検査してパースし、
//       原本を file-store に、正規化済みを dataset-store に入れる。失敗は 1 件ずつ拾って他のファイルを止めない。
// 関係: components/dataviz/DropZone.jsx → App.jsx → ここ。パーサは parsers/*。
//       上限は Plan.md の「小〜中」（CSV 20 万行 / GeoJSON 20MB / GeoTIFF 50MB）。
import { MAX_TABULAR_ROWS, parseDelimitedText } from './parsers/tabular.js'
import { MAX_GEOJSON_BYTES, parseGeoJson } from './parsers/geojson.js'
import { MAX_GEOTIFF_BYTES, parseGeoTiff } from './parsers/geotiff.js'

const TEXT_MAX_BYTES = 100 * 1024 * 1024

export function detectFileKind(fileName, mimeType = '') {
  const lower = String(fileName).toLowerCase()
  if (/\.(tif|tiff)$/.test(lower)) return 'raster'
  if (/\.(geojson|topojson)$/.test(lower)) return 'geojson'
  if (/\.(csv|tsv|tab|txt)$/.test(lower)) return 'tabular'
  if (/\.json$/.test(lower)) return 'json'
  if (mimeType.includes('tiff')) return 'raster'
  if (mimeType.includes('json')) return 'json'
  if (mimeType.includes('csv') || mimeType.includes('tab-separated')) return 'tabular'
  return 'unknown'
}

function formatBytes(n) {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}

// 1 ファイルを読んで保存形にする。読み取りは file の text() / arrayBuffer() に任せる（テストは偽 File を渡す）。
export async function importFile(file, { maxTabularRows = MAX_TABULAR_ROWS } = {}) {
  const name = file.name ?? 'untitled'
  const size = Number(file.size ?? 0)
  let kind = detectFileKind(name, file.type ?? '')

  if (kind === 'unknown') {
    throw new Error(`${name}: 対応していない形式です（csv / tsv / geojson / json / tif に対応）`)
  }
  if (kind === 'raster') {
    if (size > MAX_GEOTIFF_BYTES) throw new Error(`${name}: ${formatBytes(size)} は上限 ${formatBytes(MAX_GEOTIFF_BYTES)} を超えています`)
    const buffer = await file.arrayBuffer()
    const dataset = await parseGeoTiff(buffer, { name })
    return { dataset, original: { name, size, kind: 'raster', buffer } }
  }

  if (size > TEXT_MAX_BYTES) throw new Error(`${name}: ${formatBytes(size)} は大きすぎます`)
  const text = await file.text()

  // .json は中身を見て GeoJSON かどうか決める。
  if (kind === 'json') {
    const head = text.slice(0, 2000)
    kind = /"type"\s*:\s*"(FeatureCollection|Feature|Polygon|MultiPolygon|Point|MultiPoint|LineString|MultiLineString|GeometryCollection)"/.test(head)
      ? 'geojson'
      : 'unknown'
    if (kind === 'unknown') throw new Error(`${name}: JSON ですが GeoJSON ではないようです（表データなら csv / tsv にしてください）`)
  }

  if (kind === 'geojson') {
    if (size > MAX_GEOJSON_BYTES) throw new Error(`${name}: ${formatBytes(size)} は上限 ${formatBytes(MAX_GEOJSON_BYTES)} を超えています`)
    const dataset = await parseGeoJson(text, { name })
    return { dataset, original: { name, size, kind: 'geojson', text } }
  }

  const parsed = parseDelimitedText(text, { fileName: name, maxRows: maxTabularRows })
  return {
    dataset: { kind: 'tabular', name, ...parsed, diagnostics: parsed.warnings },
    original: { name, size, kind: 'tabular', text },
  }
}

// 複数ファイルをまとめて取り込む。{ added: [dataset...], errors: [{ name, message }] }
export async function importFiles(files, { datasetStore, fileStore, log, maxTabularRows } = {}) {
  const added = []
  const errors = []
  for (const file of files) {
    const name = file?.name ?? 'untitled'
    try {
      const { dataset, original } = await importFile(file, { maxTabularRows })
      const fileId = fileStore ? fileStore.add({ ...original, importedAt: new Date().toISOString() }).id : null
      const saved = datasetStore.add({ ...dataset, sourceFileId: fileId, byteSize: original.size, derivedFrom: null })
      added.push(saved)
      log?.(`📄 ${name} を ${saved.id} として読み込みました`)
    } catch (error) {
      const message = String(error?.message ?? error)
      errors.push({ name, message })
      log?.(`✗ ${name} の読み込みに失敗: ${message}`)
    }
  }
  return { added, errors }
}
