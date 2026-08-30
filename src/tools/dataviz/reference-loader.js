// リファレンスガイド本文の読み込み（Vite の ?raw import）。
//
// 役割: topic → reference/*.md の Markdown 文字列。**動的 import** にして、合計 160KB のガイドを
//       初期チャンクに入れない（read_reference が初めて呼ばれたときだけ取得する）。
// 関係: reference-handlers.js が使う。テストは fs で読んだ文字列を loadGuide に注入する。
export const REFERENCE_TOPICS = Object.freeze({
  dataviz: { file: 'd3js_beautiful_dataviz_guide.md', label: '一般チャート（折れ線・棒・散布図）の作法' },
  maps: { file: 'd3js_beautiful_maps_guide.md', label: '地図（投影法・コロプレス・記号・ラベル）の作法' },
  geojson: { file: 'd3_geojson_turf_rendering_guide.md', label: 'GeoJSON が正しく描けないときの診断と turf による修正' },
  raster: { file: 'd3_raster_visualization_geoexamples_guide.md', label: 'ラスタ（GeoTIFF）の再投影・補間・等値線・陰影' },
})

const LOADERS = {
  dataviz: () => import('../../../reference/d3js_beautiful_dataviz_guide.md?raw'),
  maps: () => import('../../../reference/d3js_beautiful_maps_guide.md?raw'),
  geojson: () => import('../../../reference/d3_geojson_turf_rendering_guide.md?raw'),
  raster: () => import('../../../reference/d3_raster_visualization_geoexamples_guide.md?raw'),
}

export async function loadGuide(topic) {
  const loader = LOADERS[topic]
  if (!loader) throw new Error(`不明な topic: ${topic}（${Object.keys(LOADERS).join(' / ')} のいずれか）`)
  const mod = await loader()
  return mod.default
}
