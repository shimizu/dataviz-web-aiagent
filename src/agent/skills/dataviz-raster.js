// ラスタ（GeoTIFF）を描くための指針スキル（Markdown 文字列・決定的）。
//
// 役割: reference/d3_raster_visualization_geoexamples_guide.md（3,186 行）の考え方（output-driven の逆引き再投影・
//       補間の使い分け・LUT・nodata・等値線・凡例・ハイブリッド構成）を、このアプリの geoWarp（src/viz-runtime/geo-warp.js）の
//       API に沿って圧縮したもの。揮発情報は含めない。
// 関係: tools/dataviz/index.js が skills に載せる。目次は test/dataviz-skills.test.js が実ファイルと突き合わせる。
// 流用元: reference/d3_raster_visualization_geoexamples_guide.md §1〜§5・§7〜§9・§11〜§13・§16〜§18・§34〜§36・§43〜§44・§52・§63・§66

export const RASTER_REFERENCE_TOC = [
  ['1', 'このサイトから得られる最も重要な考え方'],
  ['3', 'GeoTIFFをD3で扱うときのGeoTransform'],
  ['5', 'D3ラスター描画の核心: output-driven rendering'],
  ['7', '最近傍法によるラスター描画'],
  ['8', 'Bilinear interpolation'],
  ['11', 'Color Lookup Table（LUT）'],
  ['12', 'NoDataと表示範囲外'],
  ['13', '投影済みGeoTIFF'],
  ['16', 'Isolines'],
  ['17', 'Isobands'],
  ['34', 'Legend'],
  ['35', 'Threshold / Sequential scaleの使い分け'],
  ['36', 'Shaded relief / Hillshade'],
  ['44', 'ハイブリッド構成が最も実用的'],
  ['52', 'Raster renderingを高速化する優先順位'],
  ['63', 'どの方法を使うべきか'],
  ['66', '最重要ポイントまとめ'],
]

const toc = RASTER_REFERENCE_TOC.map(([n, t]) => `| ${n} | ${t} |`).join('\n')

export const DATAVIZ_RASTER_SKILL = `# スキル: ラスタ（GeoTIFF）の作法

## 守る規則（MUST）

1. **MUST: nodata を 0 と混同しない** — nodata は透明のまま残す（geoWarp が自動で透明にする）。0 で埋めると偽の値になる。
2. **MUST: 分類ラスタ（土地被覆・クラス ID）は \`interpolation('nearest')\`** — bilinear は存在しない中間クラスを作る。
3. **MUST: \`size\` は長辺 1200 まで** — それ以上は遅いだけで見た目は変わらない。
4. **MUST: 2 枚を比べるときは同じ \`domain\`** — 凡例も共通にする。別々だと色の意味がズレる。
5. **MUST: ラスタの上の文字・線はインク色 + 白縁** — ラスタの色と競合させない（\`theme.label.haloWidth\` の halo）。
6. **MUST: \`projection\` は invert を持つもの** — \`geoAlbersUsa\` は使えない（エラーになる）。

## 1. データの形

\`datasets[id].raster\` = \`{ width, height, bbox: [west, south, east, north], crs, nodata, bands: [Float32Array, ...] }\`。
値は \`bands[b][y * width + x]\`（左上原点・北が上）。\`describe_dataset\` でバンドごとの min / max / mean / 有効数と、
CRS（\`EPSG:4326\` / \`EPSG:3857\` / その他）、nodata、表示用に間引かれているかを先に確認する。

## 2. 描き方の核心: 出力ピクセルから逆引きする

ラスタを D3 の投影に載せるには「元のセルを前向きに投影する」のではなく、**出力の各ピクセル → \`projection.invert\` →
経緯度 → ラスタのピクセル → 値 → 色**と逆引きする（前向きだと穴が空く）。この計算は \`geoWarp\` が行う。

\`\`\`js
// 何を示す図か: 年平均気温の分布（等積図法）
function render({ container, d3, turf, geoWarp, datasets, width, height, theme }) {
  const r = datasets.ds_001.raster
  const stats = datasets.ds_001.metadata.stats[0]
  const m = { top: 56, right: 24, bottom: 48, left: 24 }
  const w = width - m.left - m.right, h = height - m.top - m.bottom
  // 投影はラスタの範囲に合わせる（世界なら Sphere、地域なら bbox の多角形に fit）
  const extent = turf.bboxPolygon(r.crs === 'EPSG:3857' ? turf.bbox(turf.toWgs84(turf.bboxPolygon(r.bbox))) : r.bbox)
  const projection = d3.geoEqualEarth().fitSize([w, h], extent)
  const color = d3.scaleSequential(d3.interpolateYlOrRd).domain([stats.min, stats.max]) // 量は単色〜暖色の連続ランプ
  const url = geoWarp().raster(r).band(0).projection(projection).size([w, h])
    .interpolation('bilinear').color(color).domain(color.domain()).toDataURL()

  const svg = d3.select(container).append('svg').attr('width', width).attr('height', height).attr('viewBox', [0, 0, width, height])
    .attr('font-family', theme.font.family).attr('font-size', theme.font.axis).style('background', theme.colors.background)
  svg.append('title').text('年平均気温の分布')
  const g = svg.append('g').attr('transform', \`translate(\${m.left},\${m.top})\`)
  g.append('image').attr('href', url).attr('width', w).attr('height', h)
  g.append('path').datum({ type: 'Sphere' }).attr('d', d3.geoPath(projection)).attr('fill', 'none').attr('stroke', theme.map.borders.national)
  // 凡例: 描画と同じ color スケールから作る
  // タイトル・単位・出典は svg 内に文字で描く
}
\`\`\`

### geoWarp の API（すべてチェーン可能）
| メソッド | 内容 |
|---|---|
| \`.raster(r)\` | \`datasets[id].raster\` をそのまま渡す（\`crs\` が \`EPSG:3857\` なら経緯度→メートルの変換を内部で行う） |
| \`.band(i)\` | バンド番号（既定 0）。\`Float32Array\` を直接渡してもよい（計算した派生バンドなど） |
| \`.projection(p)\` | **invert を持つ** d3 投影（\`geoAlbersUsa\` は不可） |
| \`.size([w, h])\` | 出力ピクセル。**長辺 1200 まで**（それ以上は遅い） |
| \`.color(fn)\` | 値 → 色（CSS 文字列でも \`[r, g, b, a]\` でも可）。省略時はグレースケール |
| \`.domain([min, max])\` | 色の値域（LUT は 256 段階で事前計算）。省略時はバンドの min / max |
| \`.interpolation('nearest' \\| 'bilinear')\` | 連続値は bilinear、分類値（土地被覆・クラス ID）は nearest |
| \`.mask(geojson)\` | この地物の内側だけ塗る（既定は球全体）。海をくり抜くなど |
| \`.toDataURL()\` / \`.toCanvas()\` / \`.toImageData()\` | \`<image href>\` に埋める data URL / canvas / 生データ |

- nodata と NaN は透明になる。値域外はクランプ（端の色）される。
- 分類ラスタは \`d3.scaleOrdinal(classes, theme.series)\` を \`.color\` に渡し、\`interpolation('nearest')\`（分類は 8 種まで。超えるなら統合）。
- 2 枚を比べるときは同じ \`domain\` を使う（凡例も共通に）。

### 色スケールの選び方
| 値の性質 | スケール |
|---|---|
| 量（気温・降水・標高・濃度） | \`d3.scaleSequential(d3.interpolateBlues / YlGnBu / YlOrRd / Viridis)\`。**虹色は使わない** |
| 基準からの差（偏差・変化） | \`d3.scaleDiverging([lo, 0, hi], d3.interpolateRdBu)\`（赤 = 負、青 = 正、中央は無彩色） |
| 階級（風速階級・区分） | \`d3.scaleThreshold(thresholds, theme.sequential.blue5)\` |
| 分類（土地被覆・クラス） | \`d3.scaleOrdinal(classes, theme.series)\` + nearest |
| 陰影 | グレースケール（\`.color\` 省略）を下敷きに、上の色ラスタを opacity 0.7 |

ラスタの上に重ねるベクタ（境界・等値線・ラベル）はインク色（\`theme.colors.text\` / \`secondaryText\`）か白縁つきにして、
ラスタの色と競合させない。

## 3. 凡例

- **描画に使った \`color\` スケールから作る**。連続値は幅 120〜200px の帯（\`d3.range(0, 1, 1/64)\` で細い rect を並べるか、
  小さな canvas に描いて \`<image>\`）+ 両端と中央の目盛り。分類は色見本 + ラベル。
- 単位・時点・出典はサブタイトルか凡例の脇に。

## 4. 等値線（isoline）と階級面（isoband）

\`d3.contours()\`（d3 同梱）はグリッド配列から GeoJSON を作る。座標はグリッドの (x, y) なので、経緯度へ戻してから投影する。

\`\`\`js
const { width: rw, height: rh, bbox, nodata, bands } = r
const values = Float64Array.from(bands[0], (v) => (v === nodata || Number.isNaN(v) ? NaN : v))
const contours = d3.contours().size([rw, rh]).thresholds(8)(values) // [{ type: 'MultiPolygon', value, coordinates }]
const toLonLat = ([x, y]) => [bbox[0] + (x / rw) * (bbox[2] - bbox[0]), bbox[3] - (y / rh) * (bbox[3] - bbox[1])]
const geoContours = contours.map((c) => ({ ...c, coordinates: c.coordinates.map((poly) => poly.map((ring) => ring.map(toLonLat))) }))
g.selectAll('path.iso').data(geoContours).join('path').attr('class', 'iso').attr('d', d3.geoPath(projection))
  .attr('fill', 'none').attr('stroke', theme.colors.text).attr('stroke-width', 0.6).attr('stroke-opacity', 0.6)
\`\`\`

- \`fill\` を付ければ階級面（isoband）になる（\`d3.scaleThreshold\` で色）。ラスタの塗りは弱め（不透明度 0.6）にして重ねる。
- 等値線のラベルは数本だけ（値の大きい線の端に）。
- 気圧・標高は等値線、気温・降水は塗り + 数本の等値線、風速階級・区分は階級面が読みやすい。

## 5. 陰影（hillshade）

標高（DEM）なら中央差分で勾配を出し、\`shade = sin(alt)·sin(slope) + cos(alt)·cos(slope)·cos(az − aspect)\` を
0〜255 のグレーにして別バンドとして \`geoWarp().band(shadeArray)\`。色ラスタの下に敷き、上の塗りを \`opacity 0.7\` で重ねる。
ピクセル間隔（度 → m）と CRS を考慮しないと陰影の強さが狂うので、目安として使う。

## 6. 高速化の優先順位（守ること）

1. ピクセルを SVG の \`<rect>\` で描かない（必ず canvas → \`<image>\`）。
2. 出力サイズは表示に必要な分だけ（\`size\` は長辺 1200 まで）。
3. 色は LUT（\`.domain\` を指定すれば 256 段階で事前計算される）。
4. バンドは Float32Array のまま（配列の配列に変換しない）。
5. 投影オブジェクトはループ外で 1 回作る。
6. 表示用に間引き済みのデータを使う（原寸が要る集計はユーザーに事前処理を提案）。

## 7. ハイブリッド構成

ラスタ（canvas 由来の \`<image>\`）+ SVG のベクタ（境界線・等値線・記号・ラベル・凡例）。境界線は別の geojson データセットを
同じ \`projection\` で描く。海・国境・graticule の色は \`theme.map.*\`。

| データ | 表現 |
|---|---|
| 気温・海面水温 | 補間ラスタ（bilinear）+ 数本の等値線 |
| 降水量 | ラスタ + 階級面 |
| 気圧 | 等値線 |
| 標高 | 色ラスタ + 陰影 |
| 土地被覆・分類 | nearest ラスタ + 分類凡例 |
| 風速 | 階級面 / ラスタ |

## 8. よくある事故と修正

- ❌ EPSG:3857 の bbox（メートル）をそのまま \`fitSize\` の対象にして図が消える → ✅
  \`turf.toWgs84(turf.bboxPolygon(r.bbox))\` で経緯度の範囲にしてから fit（§2 の例）。geoWarp 自体は crs を見て内部で変換する。
- ❌ \`d3.contours\` に nodata の生値（-9999 等）が入り等値線が縁でギザつく → ✅ 先に nodata を NaN に置き換える（§4 の例）。
- ❌ 外れ値に引っ張られて図がほぼ 1 色 → ✅ \`domain\` を stats の min / max か分位（5%〜95%）で明示する。
- ❌ 凡例が描画と別のスケール → ✅ \`.color\` に渡したスケールから凡例を作る。
- ❌ 陰影が真っ黒 / 真っ白 → ✅ shade を 0〜255 に正規化してから \`band\` に渡す。強さはあくまで目安（CRS の距離を無視している）。

## 9. 詳細（read_reference('raster', 番号)）

| 番号 | 節 |
|---|---|
${toc}`
