// データセットの正規化形と、その要約・受け渡し形への変換（純関数）。
//
// 役割: tabular / geojson / raster の 3 種類を 1 つの形に揃え、
//       - toRuntimeDataset(): 隔離 Worker（execute_javascript）と可視化フレーム（render）へ渡す共通形
//       - describeDataset(): describe_dataset ツールが LLM へ返す要約（全行・全地物は返さない）
//       を作る。ブラウザ API に触れないので node --test で検証できる。
// 関係: parsers/* が保存形を作り、dataset-store が保持し、tools/dataviz が describe を返す。
//       Worker 側の toWorkerDataset は records / columns / metadata しか拾わないため、
//       geojson / raster の本体は **metadata にも入れる**（structured clone は同一参照を 1 回しか複製しない）。

export const DATASET_KINDS = ['tabular', 'geojson', 'raster']
// LLM へ返すサンプル・列の上限（tool_result は 8000 文字で打ち切られるので自前で絞る）。
export const MAX_SAMPLE_ROWS = 20
export const MAX_LISTED_COLUMNS = 30
export const MAX_TOP_VALUES = 5

function pickColumns(columns = []) {
  return columns.map((c) => ({ name: c.name, type: c.type }))
}

// 隔離実行（Worker / フレーム）へ渡す形。
export function toRuntimeDataset(ds) {
  if (!ds) return null
  const geojson = ds.kind === 'geojson' ? (ds.displayFeatureCollection ?? ds.featureCollection) : null
  const raster =
    ds.kind === 'raster'
      ? { width: ds.width, height: ds.height, bbox: ds.bbox, crs: ds.crs, nodata: ds.nodata, bands: ds.bands }
      : null
  const records = ds.kind === 'tabular' ? (ds.records ?? []) : ds.kind === 'geojson' ? (geojson?.features ?? []) : []
  const columns = pickColumns(ds.kind === 'geojson' ? ds.propertiesSchema : ds.columns)
  const metadata = {
    datasetId: ds.id,
    name: ds.name,
    kind: ds.kind,
    ...(ds.kind === 'tabular' ? { rowCount: ds.rowCount } : {}),
    ...(ds.kind === 'geojson'
      ? { featureCount: ds.featureCount, geometryTypes: ds.geometryTypes, bbox: ds.bbox, diagnostics: ds.diagnostics, simplified: Boolean(ds.displayFeatureCollection) }
      : {}),
    ...(ds.kind === 'raster'
      ? { width: ds.width, height: ds.height, bbox: ds.bbox, crs: ds.crs, nodata: ds.nodata, bandCount: ds.bandCount, stats: ds.stats, geoTransform: ds.geoTransform }
      : {}),
    geojson,
    raster,
  }
  return { id: ds.id, name: ds.name, kind: ds.kind, columns, records, metadata, geojson, raster }
}

// 一覧（list_datasets）用の 1 行。
export function summarizeDataset(ds) {
  const base = { id: ds.id, name: ds.name, kind: ds.kind }
  if (ds.derivedFrom) base.derivedFrom = ds.derivedFrom
  if (ds.kind === 'tabular') {
    return { ...base, rowCount: ds.rowCount, columns: (ds.columns ?? []).slice(0, MAX_LISTED_COLUMNS).map((c) => `${c.name}:${c.type}`) }
  }
  if (ds.kind === 'geojson') {
    return { ...base, featureCount: ds.featureCount, geometryTypes: ds.geometryTypes, properties: (ds.propertiesSchema ?? []).slice(0, MAX_LISTED_COLUMNS).map((c) => `${c.name}:${c.type}`) }
  }
  return { ...base, size: `${ds.width}×${ds.height}`, bandCount: ds.bandCount, crs: ds.crs }
}

function sampleRows(records = [], count) {
  return records.slice(0, count)
}

// describe_dataset の戻り値（要約のみ）。
export function describeDataset(ds, { sample = 5, stats = true } = {}) {
  if (!ds) return null
  const sampleCount = Math.max(0, Math.min(MAX_SAMPLE_ROWS, Math.floor(Number(sample) || 0)))
  const head = { id: ds.id, name: ds.name, kind: ds.kind, ...(ds.derivedFrom ? { derivedFrom: ds.derivedFrom } : {}) }

  if (ds.kind === 'tabular') {
    return {
      ...head,
      rowCount: ds.rowCount,
      columns: (ds.columns ?? []).map((c) => (stats ? c : { name: c.name, type: c.type })),
      sample: sampleRows(ds.records, sampleCount),
    }
  }
  if (ds.kind === 'geojson') {
    const features = (ds.featureCollection?.features ?? []).slice(0, sampleCount)
    return {
      ...head,
      featureCount: ds.featureCount,
      geometryTypes: ds.geometryTypes,
      bbox: ds.bbox,
      vertexCount: ds.vertexCount,
      simplifiedForDisplay: Boolean(ds.displayFeatureCollection),
      properties: (ds.propertiesSchema ?? []).map((c) => (stats ? c : { name: c.name, type: c.type })),
      sampleProperties: features.map((f) => f?.properties ?? {}),
      diagnostics: ds.diagnostics ?? [],
    }
  }
  return {
    ...head,
    width: ds.width,
    height: ds.height,
    originalSize: `${ds.originalWidth}×${ds.originalHeight}`,
    downsampled: ds.width !== ds.originalWidth || ds.height !== ds.originalHeight,
    bbox: ds.bbox,
    crs: ds.crs,
    nodata: ds.nodata,
    bandCount: ds.bandCount,
    bands: stats ? ds.stats : undefined,
    geoTransform: ds.geoTransform,
    diagnostics: ds.diagnostics ?? [],
  }
}

// 揮発ブロック（contextParts）と音声の buildContext に出す一覧。
export function formatDatasetList(datasets = []) {
  if (datasets.length === 0) return ''
  const lines = datasets.map((ds) => {
    if (ds.kind === 'tabular') return `- ${ds.id}: ${ds.name}（表・${ds.rowCount} 行 × ${ds.columns?.length ?? 0} 列）`
    if (ds.kind === 'geojson') return `- ${ds.id}: ${ds.name}（GeoJSON・${ds.featureCount} 地物・${(ds.geometryTypes ?? []).join('/')}）`
    return `- ${ds.id}: ${ds.name}（ラスタ・${ds.width}×${ds.height}・${ds.bandCount} バンド）`
  })
  return `## 読み込み済みデータセット\n${lines.join('\n')}`
}
