// GeoJSON が正しく描けないときの診断と修正のスキル（Markdown 文字列・決定的）。
//
// 役割: reference/d3_geojson_turf_rendering_guide.md（947 行）を「症状 → 確認 → render 内での直し方」に圧縮したもの。
//       describe_dataset の diagnostics（parsers/geojson.js が出す）と対応させ、座標を自動修正しないアプリの方針を
//       Claude 側で補う。揮発情報は含めない。
// 関係: tools/dataviz/index.js が skills に載せる。目次は test/dataviz-skills.test.js が実ファイルと突き合わせる。
// 流用元: reference/d3_geojson_turf_rendering_guide.md §2〜§16・§18

// read_reference('geojson', <番号>) で読める節（番号と見出しはガイドと一致させる）。
export const GEOJSON_REFERENCE_TOC = [
  ['2', 'よくある問題一覧'],
  ['3', 'Polygonのリング方向'],
  ['4', '緯度・経度が逆になっている'],
  ['5', 'EPSG:3857などの投影済み座標が入っている'],
  ['9', '頂点数が多すぎる'],
  ['10', 'NaN / null / Infinityなどの不正座標'],
  ['11', '日付変更線を跨ぐGeometry'],
  ['12', '投影済みGeoJSONをそのまま描画する場合'],
  ['13', 'D3描画前のGeoJSON正規化関数'],
  ['14', '無条件に実行しない方がよい処理'],
  ['16', 'GISデータをD3へ渡す前の推奨診断フロー'],
  ['17', '問題切り分けの実践的な順序'],
]

const toc = GEOJSON_REFERENCE_TOC.map(([n, t]) => `| ${n} | ${t} |`).join('\n')

export const DATAVIZ_GEOJSON_SKILL = `# スキル: GeoJSON の診断と修正

\`kind: geojson\` のデータセットを描く前に読む。このアプリは**取り込み時に座標を書き換えない**（\`describe_dataset\` の
\`diagnostics\` に疑わしい点を列挙するだけ）。修正は render 内で、根拠のあるものだけ行う。

## 守る規則（MUST）

1. **MUST: \`turf.rewind\` は diagnostics に「時計回り」の指摘があるときだけ** — 正常なデータに掛けると逆に壊れる。
2. **MUST: \`turf.flip\` / \`turf.toWgs84\` は根拠があるときだけ** — flip は座標順が逆と確認できたとき、
   toWgs84 は Web メルカトル（EPSG:3857）のときだけ。他の EPSG はブラウザで変換できない。
3. **MUST: NaN / null 座標の地物を除いてから描く** — 1 地物の不正で path 全体が失敗する。
4. **MUST: 投影済み座標は \`d3.geoIdentity().reflectY(true)\`** — \`geoMercator\` を重ねると二重投影で崩れる。
5. **MUST: \`turf.simplify\` は表示にだけ使う** — 面積・長さの集計は原本（\`featureCollection\`）で行う。

## 1. diagnostics と対処の対応

| diagnostics / 症状 | 確認すること | render 内での対処 |
|---|---|---|
| 外周リングが時計回り / 描くと**地球全体が塗られる**・内外が反転 | 他の GIS では正常に見えるのに D3 だけ反転する | \`fc = turf.rewind(fc, { reverse: true })\`（D3 は球面の巻き方向で内外を決める） |
| \\|経度\\| > 180 や \\|緯度\\| > 90 の座標 / 何も表示されない・巨大な座標値 | bbox が数百万の桁 → EPSG:3857 などの投影済み座標 | \`d3.geoIdentity().reflectY(true).fitExtent(...)\` で「そのまま」描く。経緯度が必要なら \`turf.toWgs84(fc)\`（Web メルカトルのときだけ） |
| 経度が ±90 に収まっている / **まったく違う場所**に出る | サンプル座標が \`[緯度, 経度]\` の順になっていないか | 本当に逆のときだけ \`turf.flip(fc)\`。正常なデータに掛けると壊れる |
| NaN / null の座標 / path が生成されず地物が欠ける | 該当地物の数（diagnostics に件数） | 描画前に除外する（下のスニペット） |
| bbox の経度幅 > 180 / 横に伸びた多角形 | 日付変更線を跨ぐ地物（太平洋・ロシア東部・アラスカ・フィジー） | 投影の中心を対象地域に回す（\`projection.rotate([-150, 0])\` など）。\`rewind\` では直らない |
| 頂点数が多い / 描画が遅い・SVG が巨大 | \`vertexCount\`（30 万超なら表示用の簡略版が \`geojson\` に入っている） | さらに軽くするなら \`turf.simplify(fc, { tolerance: 0.005, highQuality: false })\`（単位は度） |
| 塗りがおかしい（自己交差） | 特定の地物だけ崩れる | \`turf.unkinkPolygon(feature)\` は 1 地物が複数に割れるので、属性の対応を保ってから使う |

## 2. 安全な処理と、無条件に掛けてはいけない処理

- **ほぼ安全**: \`turf.cleanCoords(fc)\`（重複座標の除去）、\`turf.rewind(fc, { reverse: true })\`（diagnostics に指摘があるとき）。
- **根拠があるときだけ**: \`turf.flip\`（座標順）、\`turf.toWgs84\`（Web メルカトルのときだけ。他の EPSG は変換できない）、
  \`turf.unkinkPolygon\`（地物が増える）。
- \`turf.toWgs84\` で扱えない座標系（EPSG:6677 / 3099 / 32654 など）はブラウザでは変換できない。
  \`geoIdentity\` でそのまま描くか、ユーザーに事前変換（GDAL / QGIS）を提案する。

## 3. スニペット

\`\`\`js
// 不正座標を含む地物を除く（NaN / null / Infinity）
const isFinitePos = (p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])
const walk = (c) => (Array.isArray(c[0]) ? c.every(walk) : isFinitePos(c))
const clean = { type: 'FeatureCollection', features: fc.features.filter((f) => f.geometry && walk(f.geometry.coordinates)) }

// 巻き方向を直して描く（diagnostics に「時計回り」があるとき）
const fixed = turf.rewind(clean, { reverse: true })
const projection = d3.geoMercator().fitExtent([[24, 24], [width - 24, height - 24]], fixed)
const path = d3.geoPath(projection)

// 投影済み座標（メートル）をそのまま描く
const projected = d3.geoIdentity().reflectY(true).fitExtent([[24, 24], [width - 24, height - 24]], fc)

// CSV と結合する（キーの不一致は console に出して確認する）
const byKey = new Map(datasets.ds_002.records.map((r) => [String(r.code), r]))
const missing = fc.features.filter((f) => !byKey.has(String(f.properties.code))).length
console.log('結合できない地物', missing, '/', fc.features.length)
\`\`\`

## 4. 描けたか怪しいときの切り分け

1. \`console.log(turf.bbox(fc))\` — 経緯度の範囲か（±180 / ±90 を超えていないか、極端に狭くないか）。
2. 1 地物だけ描く（\`features.slice(0, 1)\`）— 出るなら他の地物の問題、出ないなら投影・座標の問題。
3. \`rewind\` の有無で見比べる。
4. \`turf.simplify\` で軽くして再描画 — 重さの問題かどうか。

console の出力は render の戻り値（\`console\` 末尾 10 件）で読める。

## 5. 大量の地物

- 数万地物・数百万頂点は SVG に向かない。\`turf.simplify\` で頂点を減らすか、面を canvas に描いて
  \`<image>\` として埋め、境界・ラベルだけ SVG に重ねる（\`d3.geoPath(projection, ctx)\` は canvas にも描ける）。

## 6. よくある事故と修正

- ❌ \`rewind\` を 2 回掛けて元に戻る → ✅ 修正は取り込み後の render 内で 1 回だけ。update のたびに重ね掛けしない（毎回、元データから作る）。
- ❌ 正常な GeoJSON に \`flip\` を掛けて世界の裏側に飛ぶ → ✅ 先にサンプル座標が \`[経度, 緯度]\` か確かめる（東京なら \`[139.7, 35.6]\`）。
- ❌ \`unkinkPolygon\` で地物が増えて属性の対応が壊れる → ✅ 分割前に \`properties\` を退避し、分割後の各地物へコピーする。
- ❌ bbox がメートルのまま \`fitSize\` に渡して図が消える → ✅ 投影済み座標は \`geoIdentity\` に渡す（\`fitSize\` 自体は使える）。
- ❌ 結合キーの型が違い全部「データなし」 → ✅ \`String(r.code)\` と \`String(f.properties.code)\` で揃え、不一致件数を console へ。

## 7. 詳細（read_reference('geojson', 番号)）

| 番号 | 節 |
|---|---|
${toc}`
