// 地図（コロプレス・比例シンボル・ラベル）を美しく作るための指針スキル（Markdown 文字列・決定的）。
//
// 役割: reference/d3js_beautiful_maps_guide.md（3,361 行）を、Claude が render コードを書くときに効く
//       「判断規則と D3 のレシピ」に圧縮したもの。このアプリの制約（GeoJSON のみ・TopoJSON / d3-hexbin / polylabel は無い・
//       静止画で書き出す）に合わせて代替手段を書き添える。揮発情報は含めない。
// 関係: tools/dataviz/index.js が skills に載せる。目次は test/dataviz-skills.test.js が実ファイルと突き合わせる。
// 流用元: reference/d3js_beautiful_maps_guide.md §1・§3〜§6・§8・§10〜§16・§18・§29〜§30 + 検証済み配色パレット（viz/viz-theme.js）

export const MAPS_REFERENCE_TOC = [
  ['1', '最初に覚えるべき15原則'],
  ['3', '地図を描く前に決めること'],
  ['4', '投影法の選び方'],
  ['5', 'projection.fitExtent()を基本にする'],
  ['6', 'レイヤー構造と視覚的階層'],
  ['8', '境界線を美しく描く'],
  ['10', 'コロプレス地図'],
  ['11', '階級区分の選び方'],
  ['12', '地図の色設計'],
  ['13', '欠損値・0・対象外を区別する'],
  ['14', '比例シンボル地図'],
  ['15', '点が多いときの表現'],
  ['16', 'ラベル配置'],
  ['17', '注釈・コールアウト・インセットマップ'],
  ['18', 'グラティキュール・海・背景'],
  ['22', 'SVG・Canvas・タイルの使い分け'],
  ['29', 'よくある失敗'],
  ['30', '完成前チェックリスト'],
]

const toc = MAPS_REFERENCE_TOC.map(([n, t]) => `| ${n} | ${t} |`).join('\n')

export const DATAVIZ_MAPS_SKILL = `# スキル: 地図の作法（コロプレス・比例シンボル・ラベル）

## 守る規則（MUST）

1. **MUST: 絶対数（人口総数・売上総額）をコロプレスに塗らない** — 面積が値に見えてしまう。率・密度に直すか比例シンボル。
2. **MUST: 一番薄い階級を白にしない** — 背景・データなしと区別が付かなくなる。最薄は \`theme.sequential.blue5[0]\` まで。
3. **MUST: 塗りの上の境界線は白 0.6px** — 黒い境界で「境界線の図」にしない。外形だけ \`theme.map.borders.coast\` 0.8px。
4. **MUST: 円の半径は \`d3.scaleSqrt\`、大きい円から先に描く** — 面積比例 + 小さい円が前。白縁 1px で重なりを切る。
5. **MUST: 地名ラベルは選んで出し、必ずハロー** — 全部出さない。\`paint-order: stroke\` + 白 \`theme.label.haloWidth\`。
6. **MUST: 種類の塗り分けは \`theme.series\` 先頭 4 色まで** — どの 2 地域も隣接しうる。5 種類以上は「その他」に畳む。

## 1. 地図にすべきかを先に決める

- 地図が強いのは**空間パターン・隣接関係・位置・集中**を見せるとき。「47 都道府県の順位」なら横棒のほうが読める。
- 読み手のタスク（どこが高い？ どこに集中？ 隣とどう違う？）で地図の型を選ぶ:

| 目的 | 表現 |
|---|---|
| 地域ごとの率・密度・割合 | コロプレス |
| 地点ごとの量（絶対数） | 比例シンボル（円） |
| 地点の場所 | ポイント / ロケーターマップ |
| 大量の点の密度 | 格子集計（\`d3.contourDensity\` か自前のグリッド） |
| 基準からの差（増減・偏差） | 発散色のコロプレス |
| 連続面（標高・気温） | ラスタ（「ラスタの作法」スキル） |

**絶対数（人口総数・売上総額・件数）をコロプレスに塗らない**。面積の大きい地域が強く見える。率・密度・一人あたりに直すか、比例シンボルにする。

## 2. 15 原則（要約）

1. Mercator を惰性で使わない（世界の統計図は等積の Equal Earth / Natural Earth）。
2. scale / translate を手計算せず \`fitExtent\` に任せる。
3. コロプレスは相対値。
4. 行政界を同じ強さで描かない（海岸線 70% > 国境 50% > 県境 25% > 市境 10%）。
5. 境界線はポリゴンごとの stroke でなく、別レイヤーで薄く 1 回。
6. 主役以外（海・背景・境界・地名）は無彩色寄りに。
7. 地図にも余白（\`fitExtent\` の padding 24〜32px）。
8. 色階級は自動で決めて終わりにしない（説明できる閾値を優先）。
9. 欠損と 0 を同じ色にしない。
10. 円の半径は \`d3.scaleSqrt\`（面積を値に比例させる）。
11. ラベルは全部出さない。
12. \`path.centroid\` は万能ではない（凹形・多島は外に出る）。
13. ズームは要るときだけ（このアプリは静止画）。
14. 大量の点を SVG に描き続けない（集約か canvas）。
15. 地図は「背景」でなく「情報構造」。タイトル・凡例・注釈・出典が同じメッセージに従う。

## 3. 投影法

| 対象 | 投影 |
|---|---|
| 世界の統計（コロプレス） | \`d3.geoEqualEarth()\`（等積） |
| 世界の概観 | \`d3.geoNaturalEarth1()\`、\`d3.geoRobinson()\`、\`d3.geoWinkel3()\` |
| 大陸・中緯度の地域 | \`d3.geoConicEqualArea().parallels([p1, p2])\`（標準緯線を対象地域に合わせる） |
| 日本 | \`d3.geoConicEqualArea().rotate([-135, 0]).parallels([30, 40])\` を \`fitExtent\` |
| 米国（本土 + AK + HI） | \`d3.geoAlbersUsa()\`（invert 無し。ラスタには使えない） |
| 地球儀・特定地点中心 | \`d3.geoOrthographic().rotate([-lon, -lat])\`、\`d3.geoAzimuthalEqualArea()\` |
| Web タイル風・方位保持 | \`d3.geoMercator()\`（面積が誇張されるので統計図には避ける） |
| 投影済み座標（メートル） | \`d3.geoIdentity().reflectY(true)\` |

\`d3\` には d3-geo-projection / d3-geo-polygon が同梱されている（\`geoInterruptedHomolosine\`、\`geoBertin1953\`、\`geoAirocean\` など）が、
読み手に馴染みのある投影を優先する。

\`\`\`js
const projection = d3.geoEqualEarth().fitExtent([[24, 56], [width - 24, height - 40]], fc) // 上はタイトル分を空ける
const path = d3.geoPath(projection)
\`\`\`

## 4. レイヤーの順序と境界線

描画順: 背景（Sphere / 海）→ graticule → 陸 → **主題データ（塗り）** → 境界線 → シンボル → ラベル → 注釈。
それぞれ \`svg.append('g')\` で分ける。

\`\`\`js
// 塗り（stroke 無し）と境界（fill 無し）を分ける。GeoJSON では共有境界が 2 回描かれるので線は細く
g.fill.selectAll('path').data(fc.features).join('path').attr('d', path).attr('fill', (d) => fill(d))
g.border.selectAll('path').data(fc.features).join('path').attr('d', path)
  .attr('fill', 'none').attr('stroke', '#ffffff').attr('stroke-width', 0.6).attr('stroke-linejoin', 'round') // 塗りの上は白い細線が最も読める
// 外形（海岸線・国境）は theme.map.borders.coast（グレー）を太め 0.8 で
\`\`\`

- 世界図は \`svg.append('path').datum({ type: 'Sphere' }).attr('d', path)\` で海（\`theme.map.ocean\`）を敷き、
  必要なら \`d3.geoGraticule10()\` を \`theme.map.graticule\`・幅 0.35・不透明度 0.55 で。主題図の graticule は無くてよい。
- 地域図（1 国・1 県）は Sphere も graticule も不要。背景は白のまま。

## 5. コロプレス

\`\`\`js
// 1. CSV と結合（キーを文字列に揃える）
const byKey = new Map(datasets.ds_002.records.map((r) => [String(r.code), r.rate]))
const value = (d) => byKey.get(String(d.properties.code)) ?? null
// 2. 階級と色（説明できる閾値。5 階級。単色ランプは theme.sequential.blue5）
const color = d3.scaleThreshold().domain([3, 5, 7, 10]).range(theme.sequential.blue5)
const fill = (d) => (value(d) == null ? theme.colors.noData : color(value(d)))
// 3. 凡例（閾値の帯 + 「データなし」）は描画に使った color から作る
const legend = svg.append('g').attr('transform', \`translate(\${width - 180}, \${height - 90})\`)
\`\`\`

- 階級: \`scaleQuantize\`（等間隔・固定区間・時系列比較向き）/ \`scaleQuantile\`（各階級の地物数が均等・色が散る）/
  **\`scaleThreshold\`（人が決めた境界。実務ではこれが扱いやすい）**。区分は 5 階級を基本、最大 7。
- **色の仕事は 1 つ**。量（率・密度）は単色ランプ（\`theme.sequential.blue5\` / \`d3.interpolateBlues\` / \`interpolateYlGnBu\`。
  一番薄い段は白ではなく \`#cde2fb\` 程度に留めて陸と区別する）。基準からの差（増減・偏差）は
  \`d3.scaleDiverging([lo, 0, hi], d3.interpolateRdBu)\`（赤 = 負、青 = 正、中央は無彩色）。
  種類（区分・カテゴリ）は \`theme.series\` の**先頭 4 色まで**（どの 2 地域も隣り合いうるため）。5 種類以上は「その他」に畳む。
  虹色・パステルの同系色・面の大きい高彩度は使わない。
- **0・データなし・対象外を区別**し、凡例にも出す（データなし = \`theme.colors.noData\`、対象外は斜線パターン \`<pattern>\`）。
- 凡例は「描画に使ったスケールそのもの」から作る（別の閾値を書かない）。単位をタイトルか凡例に。
- 北海道のように面積が大きい地域が目立つ問題は、率に直しても残る。必要なら比例シンボルや表を併記する。

## 6. 比例シンボル

\`\`\`js
const r = d3.scaleSqrt().domain([0, d3.max(rows, (d) => d.value)]).range([0, 28])
const sorted = [...rows].sort((a, b) => d3.descending(a.value, b.value)) // 大きい円を先に描き、小さい円を前に
g.symbols.selectAll('circle').data(sorted).join('circle')
  .attr('transform', (d) => \`translate(\${projection([d.lon, d.lat])})\`)
  .attr('r', (d) => r(d.value)).attr('fill', theme.colors.primary).attr('fill-opacity', 0.6)
  .attr('stroke', '#ffffff').attr('stroke-width', 1)   // 重なりは白縁で切り分ける
// 2 つの量（例: 輸出と輸入）なら theme.series の 1・2 番目（青・橙）。3 つ以上は分ける
\`\`\`

- 凡例は代表値 3 つ（最大・中間・小）の同心円か並べた円で。位置は経緯度 → \`projection([lon, lat])\`（null なら描かない）。
- 地物の中心に置くなら \`path.centroid(feature)\`。外に出る形なら \`turf.pointOnFeature(feature)\` の座標を投影する。

## 7. 点が多いとき

- 数千点まではそのまま（半径 2〜3、\`fill-opacity 0.4〜0.6\`）。数万点は集約する:
  格子で \`d3.rollup\`（経緯度を 0.1° 単位に丸めてカウント → 四角か円で描く）か \`d3.contourDensity\`（投影後の xy で）。
  d3-hexbin は同梱していない。
- 数十万点は canvas に描いて \`<image>\` で埋める。

## 8. ラベル

- 出すのは主要都市・注目地域・分析に必要な地名だけ。重要度で文字サイズを変える（国名 14 / 主要都市 12 / 都市 10 / 補助 9）。
  文字色はインク色（\`theme.map.labels.primary\` / \`secondary\`）。系列色で文字を書かない。
- 位置は \`path.centroid(d)\`。細長い・多島・凹形で外に出るなら \`turf.pointOnFeature(d)\` を投影する。
- 必ずハロー: \`.attr('paint-order', 'stroke').attr('stroke', theme.map.labels.halo).attr('stroke-width', 3).attr('stroke-linejoin', 'round')\`
  文字色は \`theme.map.labels.primary\`。
- 重なりは事前に判定できないので、数を絞る・小さい地域は省く・引き出し線（leader line）で外に出す。
- 大文字の長い国名は面積を食う。略称か letter-spacing の調整。幅は \`pretext.measureNaturalWidth\` で実測し、
  地物の幅に入らなければ略称にするか引き出し線で外に出す。

## 9. 注釈・インセット

- 見てほしい場所を 1〜2 か所、短い文と引き出し線で示す。
- 切り出した地図（1 地方など）には、全体のどこかを示す小さなインセット（同じ投影で fitSize した小図）を右下に。
- 出典・時点・単位を右下に note サイズで。

## 10. よくある失敗

1. 世界地図 = Mercator。 2. 行政界を全部黒線。 3. ポリゴンごとに太い stroke。 4. 人口総数をコロプレス。
5. 円の半径を linear scale。 6. 0 とデータなしが同じ色。 7. 8 段階以上の色。 8. 虹色・パステルの同系色。 9. ラベル全部表示。
10. 背景地図が主題より派手。 11. 図だけで全部説明しようとする（表・注釈を併せる）。 12. 一番薄い階級が白で陸と区別できない。

## 11. チェック

- 地図である必要がある / 空間パターンを 1 文で言える
- Mercator を惰性で選んでいない / \`fitExtent\` に padding がある
- 塗り > 境界 > 背景の順に強い / 海岸線と内部境界の強さが違う
- コロプレスは相対値 / 階級が説明可能 / データなしと 0 を区別し凡例にある
- 円は sqrt / 大→小の順に描いた / 凡例がある
- ラベルは重要なものだけ / ハローがある / 文字サイズの階層がある
- タイトルが「何が分かるか」を言い、出典・時点・単位がある

## 12. よくある事故と修正

- ❌ 日本だけ塗るつもりが地球全体が塗られる → ✅ 外周リングの巻き方向。\`turf.rewind(fc, { reverse: true })\`（diagnostics 参照）。
- ❌ \`fitExtent\` しても何も出ない → ✅ 座標が投影済み（メートル）。\`d3.geoIdentity().reflectY(true)\` で描くか経緯度に変換。
- ❌ 凡例の区切りが図と合わない → ✅ 描画に使った \`color\` スケールから凡例を作る（別の閾値を書き直さない）。
- ❌ 円やラベルが消える → ✅ \`projection([lon, lat])\` が範囲外で null。null を除外してから描く。
- ❌ 細長い県・多島のラベルが海に落ちる → ✅ \`path.centroid\` でなく \`turf.pointOnFeature(d)\` の座標を投影する。
- ❌ CSV と結合できない地物が灰色だらけ → ✅ キーを \`String()\` で揃え、結合できなかった件数を console に出して確認する。

## 13. 詳細（read_reference('maps', 番号)）

| 番号 | 節 |
|---|---|
${toc}`
