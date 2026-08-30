# D3.jsで美しい地図を作るための実践ガイド

> D3.js / Observable / TopoJSON / Mapshaper / Datawrapper / Mapbox / W3C WAI などの公開資料を横断し、D3.jsで「美しく、読みやすく、地理的にも誤解を生みにくい」Web地図を作るためのノウハウを整理した実践資料です。
>
> 対象: D3.js v7系  
> 調査日: 2026-08-30

---

## 目次

1. [最初に覚えるべき15原則](#1-最初に覚えるべき15原則)
2. [D3.jsの地図描画を理解する](#2-d3jsの地図描画を理解する)
3. [地図を描く前に決めること](#3-地図を描く前に決めること)
4. [投影法の選び方](#4-投影法の選び方)
5. [projection.fitExtent()を基本にする](#5-projectionfitextentを基本にする)
6. [レイヤー構造と視覚的階層](#6-レイヤー構造と視覚的階層)
7. [GeoJSONとTopoJSON](#7-geojsonとtopojson)
8. [境界線を美しく描く](#8-境界線を美しく描く)
9. [Mapshaperによる地図データの前処理](#9-mapshaperによる地図データの前処理)
10. [コロプレス地図](#10-コロプレス地図)
11. [階級区分の選び方](#11-階級区分の選び方)
12. [地図の色設計](#12-地図の色設計)
13. [欠損値・0・対象外を区別する](#13-欠損値0対象外を区別する)
14. [比例シンボル地図](#14-比例シンボル地図)
15. [点が多いときの表現](#15-点が多いときの表現)
16. [ラベル配置](#16-ラベル配置)
17. [注釈・コールアウト・インセットマップ](#17-注釈コールアウトインセットマップ)
18. [グラティキュール・海・背景](#18-グラティキュール海背景)
19. [TooltipとHover](#19-tooltipとhover)
20. [ズーム・パン](#20-ズームパン)
21. [レスポンシブ対応](#21-レスポンシブ対応)
22. [SVG・Canvas・タイルの使い分け](#22-svgcanvasタイルの使い分け)
23. [地図を高速化する](#23-地図を高速化する)
24. [アクセシビリティ](#24-アクセシビリティ)
25. [再利用可能な世界地図テンプレート](#25-再利用可能な世界地図テンプレート)
26. [再利用可能なコロプレス実装](#26-再利用可能なコロプレス実装)
27. [再利用可能なズーム実装](#27-再利用可能なズーム実装)
28. [デザイントークン](#28-デザイントークン)
29. [よくある失敗](#29-よくある失敗)
30. [完成前チェックリスト](#30-完成前チェックリスト)
31. [参考資料](#31-参考資料)

---

# 1. 最初に覚えるべき15原則

## 1. Mercatorを惰性で使わない

Web地図では Mercator がよく使われるが、

```js
d3.geoMercator()
```

が常に最適とは限らない。

特に世界全体の統計を面積で比較する thematic map では、面積歪みが大きい Mercator は不向きなことがある。

世界のコロプレスなら例えば:

```js
const projection = d3.geoEqualEarth();
```

または:

```js
const projection = d3.geoNaturalEarth1();
```

をまず検討する。

D3公式では `geoEqualEarth()` は等積投影、`geoNaturalEarth1()` は世界全体の小縮尺地図で視覚的なバランスを狙った投影として提供されている。

---

## 2. projectionのscale/translateを手計算しすぎない

地物の範囲へ自動フィットする:

```js
projection.fitExtent(
  [[padding, padding],
   [width - padding, height - padding]],
  geojson
);
```

または:

```js
projection.fitSize(
  [width, height],
  geojson
);
```

D3公式の `projection.fitExtent()` / `fitSize()` は、GeoJSONを指定領域へ収めるための基本API。

---

## 3. コロプレスに絶対数をそのまま塗らない

悪い例:

```text
都道府県別人口
国別GDP総額
市区町村別犯罪件数
```

を行政界の面積へそのまま色で割り当てる。

大きな地域や人口の多い地域が強く見えやすい。

基本的には:

```text
人口密度
一人あたりGDP
人口10万人あたり件数
割合
変化率
指数
```

などの**相対値**を使う。

Datawrapperのchoroplethガイドでも、choroplethはrelative dataに適し、absolute dataならsymbol mapを検討することが推奨されている。

---

## 4. すべての行政界を同じ強さで描かない

```text
国境
県境
市境
海岸線
```

を全部同じ黒線にすると地図がうるさくなる。

例:

```text
海岸線    70%
国境      50%
県境      25%
市境      10%
```

のような視覚的階層を作る。

---

## 5. 各ポリゴンへstrokeを付けるよりmeshを使う

悪い例:

```js
svg.selectAll("path")
  .data(countries.features)
  .join("path")
  .attr("stroke", "#fff");
```

共有境界が隣接ポリゴン双方から描画される。

TopoJSONなら:

```js
const borders = topojson.mesh(
  topology,
  topology.objects.countries,
  (a, b) => a !== b
);
```

として境界だけを**一度**描画する。

```js
svg.append("path")
  .datum(borders)
  .attr("fill", "none")
  .attr("stroke", "#fff")
  .attr("d", path);
```

見た目も安定し、描画量も減る。

---

## 6. 地図の主役以外を低彩度にする

主題データが色を持つなら、

```text
海
背景
道路
国境
地名
```

はニュートラルカラーへ寄せる。

データとベースマップが色で競合しないようにする。

---

## 7. 地図にも「余白」が必要

地理範囲いっぱいまで描くより:

```text
地図
+ 余白
+ タイトル
+ 凡例
+ 注釈
```

をひとつのレイアウトとして設計する。

```js
const padding = 28;

projection.fitExtent(
  [
    [padding, padding],
    [width - padding, height - padding]
  ],
  geojson
);
```

---

## 8. 色階級を自動で決めて終わりにしない

```js
d3.scaleQuantile()
d3.scaleQuantize()
d3.scaleThreshold()
```

は便利だが、

> データに合う分類

と

> 読み手に意味がある分類

は同じとは限らない。

失業率なら:

```text
0–3
3–5
5–7
7–10
10%以上
```

など、説明可能な閾値を優先する場合がある。

---

## 9. 欠損値と0を同じ色にしない

```js
value === 0
```

と:

```js
value == null
```

は意味が違う。

例:

```js
const noDataColor = "#e5e7eb";
```

---

## 10. 円の半径を値へ線形比例させない

比例シンボルで円の**面積**に値を対応させるなら:

```js
const radius = d3.scaleSqrt()
  .domain([0, maxValue])
  .range([0, 30]);
```

を使う。

悪い例:

```js
d3.scaleLinear()
```

を半径へ直接使う。

半径を2倍にすると面積は4倍になるため、値を過剰に強調してしまう。

---

## 11. ラベルを全部表示しない

地図上で重要なのは:

```text
何を表示するか
```

だけでなく:

```text
何を表示しないか
```

である。

表示対象を:

```text
主要都市
注目地域
ランドマーク
分析に必要な地名
```

へ絞る。

---

## 12. `path.centroid()` は便利だが万能ではない

```js
const [x, y] = path.centroid(feature);
```

は簡単だが、

- 凹形ポリゴン
- MultiPolygon
- 細長い地域
- 島が多い地域

ではラベル位置として不自然になることがある。

その場合は `polylabel` のような「polygon内部の見やすい点」を求めるアルゴリズムを検討する。

---

## 13. ZoomできることとZoomすべきことは違う

地図だからといって必ず:

```js
d3.zoom()
```

を付ける必要はない。

固定地図の方がストーリーを伝えやすい場合も多い。

Zoomは:

```text
詳細を見る必要がある
小地域が密集している
探索型UI
```

の場合に使う。

---

## 14. 大量地物をSVGで描き続けない

数十万点を:

```html
<circle>
<circle>
<circle>
...
```

とするとDOMがボトルネックになる。

大量描画では:

```text
Canvas
Hexbin
Raster
Vector tiles
WebGL
```

を検討する。

Datawrapperも大きなchoropleth / symbol mapの高速化でSVGからCanvasへ切り替えたと説明している。

---

## 15. 地図を「背景」ではなく「情報構造」として設計する

美しい地図は、

```text
ベースマップ
+
データ
+
ラベル
+
注釈
+
凡例
+
タイトル
```

がすべて同じ情報メッセージに従っている。

---

# 2. D3.jsの地図描画を理解する

D3の地図描画は大きく:

```text
GeoJSON
 ↓
Projection
 ↓
geoPath
 ↓
SVG / Canvas
```

という流れ。

---

## 2.1 Projection

経緯度:

```text
[longitude, latitude]
```

を画面座標:

```text
[x, y]
```

へ変換する。

```js
const projection =
  d3.geoEqualEarth();
```

```js
projection([139.6917, 35.6895]);
```

---

## 2.2 geoPath

GeoJSONをSVG pathへ変換する。

```js
const path =
  d3.geoPath(projection);
```

```js
svg.append("path")
  .datum(geojson)
  .attr("d", path);
```

---

## 2.3 Canvasにも描ける

```js
const context =
  canvas.getContext("2d");

const path =
  d3.geoPath(projection)
    .context(context);

context.beginPath();
path(geojson);
context.fill();
```

D3の `geoPath` はSVG専用ではない。

---

# 3. 地図を描く前に決めること

## 3.1 地図である必要があるか

地理データだから地図にする、ではない。

例:

```text
47都道府県の順位を比較
```

なら棒グラフの方が読みやすい可能性がある。

地図が強いのは:

```text
空間パターン
隣接関係
位置
距離
地域差
空間的集中
```

を見せる場合。

---

## 3.2 読み手のタスクを決める

```text
どこにある？
どこが高い？
どこに集中している？
どの方向へ移動した？
隣接地域とどう違う？
```

目的で地図タイプが変わる。

---

## 3.3 地図タイプの選択

|目的|表現|
|---|---|
|地域ごとの率|choropleth|
|地点の場所|point / locator map|
|地点ごとの量|proportional symbol|
|大量ポイント密度|hexbin / density|
|移動|flow / arc / arrow|
|標高・連続面|contour / raster|
|異常値|diverging choropleth|
|2変数|bivariate map（慎重に）|

---

# 4. 投影法の選び方

投影法は地図デザインの一部であり、単なる技術設定ではない。

---

## 4.1 世界全体

### Equal Earth

```js
d3.geoEqualEarth()
```

特徴:

```text
等積
世界統計地図に向く
極端な高緯度面積誇張が少ない
```

choroplethとの相性がよい。

---

### Natural Earth

```js
d3.geoNaturalEarth1()
```

特徴:

```text
世界全体を自然に見せやすい
視覚バランスがよい
```

D3公式も「small-scale maps of the whole world で appealing to the eye」と説明している。

---

### Mercator

```js
d3.geoMercator()
```

向く場面:

```text
Web tile地図
方位角を保つ必要
局地的なナビゲーション地図
```

世界choroplethでは面積誇張に注意。

---

## 4.2 大陸・中緯度地域

Conic projectionを検討する。

```js
d3.geoConicEqualArea()
```

```js
d3.geoConicConformal()
```

```js
d3.geoConicEquidistant()
```

標準緯線:

```js
projection.parallels([30, 50]);
```

対象地域に合わせる。

---

## 4.3 米国

```js
d3.geoAlbersUsa()
```

D3には米国本土 + Alaska + Hawaii のcomposite projectionがある。

---

## 4.4 地球儀表現

```js
d3.geoOrthographic()
```

ストーリーテリングには美しいが、半球しか同時に見えない。

---

## 4.5 方位を中心に見せたい

```js
d3.geoAzimuthalEqualArea()
d3.geoAzimuthalEquidistant()
```

極域や中心地点からの関係を表す場合に有効。

---

# 5. projection.fitExtent()を基本にする

地図の範囲に合わせて投影を自動設定する。

```js
const projection =
  d3.geoEqualEarth();

projection.fitExtent(
  [
    [24, 24],
    [width - 24, height - 24]
  ],
  geojson
);
```

---

## 5.1 `fitSize`

```js
projection.fitSize(
  [width, height],
  geojson
);
```

---

## 5.2 `fitWidth`

```js
projection.fitWidth(
  width,
  geojson
);
```

横幅を固定し、高さを地理形状に合わせたいレスポンシブUIで便利。

---

## 5.3 適度なpaddingを残す

悪い例:

```js
projection.fitSize([width, height], geojson);
```

で地物が画面端へ密着。

良い例:

```js
projection.fitExtent(
  [
    [32, 24],
    [width - 32, height - 24]
  ],
  geojson
);
```

---

# 6. レイヤー構造と視覚的階層

美しいD3地図は、レイヤーを明示的に分ける。

```js
const layers = {
  background:
    svg.append("g")
      .attr("class", "background"),

  graticule:
    svg.append("g")
      .attr("class", "graticule"),

  land:
    svg.append("g")
      .attr("class", "land"),

  data:
    svg.append("g")
      .attr("class", "data"),

  borders:
    svg.append("g")
      .attr("class", "borders"),

  labels:
    svg.append("g")
      .attr("class", "labels"),

  annotations:
    svg.append("g")
      .attr("class", "annotations"),

  interaction:
    svg.append("g")
      .attr("class", "interaction")
};
```

---

## 推奨描画順

```text
1. 背景
2. 海
3. graticule
4. 陸地
5. 主題データ
6. 行政界
7. シンボル
8. ラベル
9. 注釈
10. interaction
```

---

# 7. GeoJSONとTopoJSON

## GeoJSON

扱いやすい。

```json
{
  "type": "FeatureCollection",
  "features": []
}
```

D3はGeoJSONを直接扱える。

---

## TopoJSON

TopoJSONは共有境界を「arc」として共有する。

例えば隣接する県Aと県Bの境界をGeoJSONでは双方が持つが、TopoJSONでは共有できる。

メリット:

```text
ファイルサイズ削減
境界の一貫性
topology-preserving simplification
mesh生成
隣接判定
```

TopoJSON公式は、重複を排除することでGeoJSONより大幅に小さくなる場合があり、共有境界を利用したsimplificationなどが可能と説明している。

---

## 7.1 TopoJSON → GeoJSON

```js
import {
  feature,
  mesh
} from "topojson-client";

const countries =
  feature(
    world,
    world.objects.countries
  );
```

---

# 8. 境界線を美しく描く

## 8.1 Fillとborderを分離する

```js
svg.append("g")
  .selectAll("path")
  .data(countries.features)
  .join("path")
  .attr("fill", d => color(value(d)))
  .attr("d", path);
```

境界は別レイヤー。

```js
const borders =
  topojson.mesh(
    world,
    world.objects.countries,
    (a, b) => a !== b
  );

svg.append("path")
  .datum(borders)
  .attr("fill", "none")
  .attr("stroke", "#ffffff")
  .attr("stroke-width", 0.6)
  .attr("stroke-linejoin", "round")
  .attr("d", path);
```

---

## 8.2 海岸線と内部境界を分ける

海岸線:

```js
const land =
  topojson.feature(
    world,
    world.objects.land
  );
```

```js
svg.append("path")
  .datum(land)
  .attr("fill", "none")
  .attr("stroke", "#64748b")
  .attr("stroke-width", 0.7)
  .attr("d", path);
```

内部境界:

```js
.attr("stroke", "#fff")
.attr("stroke-width", 0.45)
```

---

## 8.3 `vector-effect`

SVG zoom時に境界線を一定太さに保つ方法:

```css
.map-border {
  vector-effect: non-scaling-stroke;
}
```

ただし大量pathではブラウザ負荷も確認する。

別方法としてzoom transformに応じ:

```js
.attr(
  "stroke-width",
  1 / transform.k
);
```

とする。

Observableの「Zoom to bounding box」でも、zoom倍率に応じてstroke-widthを補正するパターンが使われている。

---

# 9. Mapshaperによる地図データの前処理

Web地図で最も効く最適化の一つ。

Mapshaper:

https://mapshaper.org/

---

## 9.1 Simplification

例:

```bash
mapshaper prefectures.geojson \
  -simplify 10% keep-shapes \
  -clean \
  -o prefectures-simplified.topojson
```

Mapshaperのdefault simplificationはweighted Visvalingam。

公式ガイドでは、Web地図向けにvertex数を減らしながら形状をなるべく維持する用途として説明されている。

---

## 9.2 表示解像度を基準にsimplify

```bash
mapshaper input.geojson \
  -simplify resolution=1200 \
  -o output.topojson
```

「最終表示が1000px程度なのに数百万vertexを持つ海岸線」を配信する必要はない。

---

## 9.3 小島を維持する

```bash
-simplify 5% keep-shapes
```

高いsimplificationで小ポリゴンが消えるのを防ぐ。

---

## 9.4 `clean`

```bash
-clean
```

simplification後の自己交差などを確認・修復する。

---

## 9.5 Dissolve

細かい行政界から上位行政界を作る。

```bash
mapshaper municipalities.geojson \
  -dissolve PREF_CODE \
  -o prefectures.geojson
```

shared topologyが必要な場合、同じ詳細レイヤーから上位レイヤーを作る方が境界を一致させやすい。

---

## 9.6 TopoJSON出力

```bash
mapshaper input.geojson \
  -simplify 10% \
  -o format=topojson output.json
```

Web地図では非常に有効。

---

# 10. コロプレス地図

基本形:

```js
const color =
  d3.scaleSequential()
    .domain(
      d3.extent(values)
    )
    .interpolator(
      d3.interpolateBlues
    );
```

```js
map.selectAll("path")
  .data(features)
  .join("path")
  .attr(
    "fill",
    d => {
      const v = valueById.get(d.id);

      return v == null
        ? "#e5e7eb"
        : color(v);
    }
  )
  .attr("d", path);
```

---

## 10.1 choroplethが向く値

```text
割合
率
密度
一人あたり
面積あたり
指数
平均との差
変化率
```

---

## 10.2 choroplethが向かない値

```text
人口総数
売上総額
施設総数
事故総数
GDP総額
```

絶対数なら比例シンボルをまず検討。

---

## 10.3 地域サイズによる視覚バイアス

北海道のような大きい地域は視覚面積を大きく占める。

人口への影響を見せたいなら:

```text
cartogram
symbol map
dot density
```

なども検討する。

---

# 11. 階級区分の選び方

D3にはいくつかの分類scaleがある。

---

## 11.1 Quantize

値域を等間隔に分割。

```js
const color =
  d3.scaleQuantize()
    .domain([0, 100])
    .range(d3.schemeBlues[5]);
```

例:

```text
0–20
20–40
40–60
60–80
80–100
```

向く:

```text
値域に意味がある
固定区間を維持したい
時系列比較
```

---

## 11.2 Quantile

各階級のfeature数がおおむね均等になる。

```js
const color =
  d3.scaleQuantile()
    .domain(values)
    .range(d3.schemeBlues[5]);
```

長所:

```text
色が地図全体へ分散しやすい
```

短所:

```text
閾値が直感的でない場合がある
年ごとにbreakが変わる
```

---

## 11.3 Threshold

人間が決めた境界。

```js
const color =
  d3.scaleThreshold()
    .domain([
      3,
      5,
      7,
      10
    ])
    .range(
      d3.schemeBlues[5]
    );
```

実務では非常に使いやすい。

例:

```text
<3
3–5
5–7
7–10
>=10
```

---

## 11.4 Natural Breaks / Jenks

D3 coreにはJenks classifierは含まれない。

必要なら:

```text
simple-statistics
GIS側
Python
R
Mapshaper
```

などで事前計算する。

ただし時系列地図で毎時点Natural Breaksを再計算すると、「色が変わったのに値はほぼ変わっていない」という問題が起きる。

比較目的なら固定breakを検討する。

---

# 12. 地図の色設計

## 12.1 Sequential

低 → 高。

```js
d3.interpolateBlues
d3.interpolateGreens
d3.interpolateYlOrRd
d3.interpolateViridis
```

---

## 12.2 Diverging

基準値を中心に両方向。

```js
const color =
  d3.scaleDiverging()
    .domain([-10, 0, 10])
    .interpolator(
      d3.interpolateRdBu
    );
```

用途:

```text
前年差
平均との差
偏差
増減
選挙得票差
```

---

## 12.3 Qualitative

カテゴリ。

```js
const color =
  d3.scaleOrdinal()
    .domain(categories)
    .range(d3.schemeTableau10);
```

面積の大きいポリゴンでは高彩度色を多用しない。

---

## 12.4 ベースマップは無彩色へ

主題データ:

```text
blue
red
orange
green
```

を使うなら背景:

```css
--ocean: #f8fafc;
--land-base: #f1f5f9;
--border: #cbd5e1;
--label: #64748b;
```

などへ抑える。

---

## 12.5 色覚多様性

色だけで:

```text
対象
欠損
推計値
未確定
```

を区別しない。

pattern / hatchも使える。

Datawrapperではchoropleth上にpattern overlayを追加し、不完全データなどの補助カテゴリを示すアプローチを紹介している。

SVGなら:

```html
<pattern>
```

を利用できる。

---

# 13. 欠損値・0・対象外を区別する

最低でも:

```text
0
missing
not applicable
```

を区別する。

例:

```js
function fillColor(value, applicable = true) {

  if (!applicable) {
    return "url(#not-applicable)";
  }

  if (value == null) {
    return "#e5e7eb";
  }

  return color(value);
}
```

---

## 凡例にも表示する

```text
■ 0–5%
■ 5–10%
■ 10–20%
□ データなし
//// 対象外
```

地図上だけ違えても、凡例に説明がなければ意味が伝わらない。

---

# 14. 比例シンボル地図

例:

```js
const r =
  d3.scaleSqrt()
    .domain([
      0,
      d3.max(data, d => d.population)
    ])
    .range([0, 32]);
```

```js
svg.selectAll("circle")
  .data(data)
  .join("circle")
  .attr(
    "transform",
    d =>
      `translate(${
        projection([
          d.longitude,
          d.latitude
        ])
      })`
  )
  .attr(
    "r",
    d => r(d.population)
  );
```

---

## 14.1 小さい円を前面へ

大きい円から描く。

```js
data.sort(
  (a, b) =>
    d3.descending(
      a.value,
      b.value
    )
);
```

SVGは後から描いた要素が上になるので、大→小順なら小さい円が最後に描かれ見えやすい。

ObservableのBubble map例でも値でdescending sortするパターンが使われている。

---

## 14.2 fill-opacityを下げる

```js
.attr("fill-opacity", 0.55)
```

重なりを見せる。

---

## 14.3 strokeで輪郭を保つ

```js
.attr("stroke", "#fff")
.attr("stroke-width", 0.7)
```

背景と区別しやすくなる。

---

# 15. 点が多いときの表現

数万点をそのまま描くより集約する。

---

## 15.1 Hexbin

ObservableにはD3 + d3-hexbinの地図例がある。

```js
const hexbin =
  d3Hexbin.hexbin()
    .radius(10);
```

位置をprojectionしてからbinningする。

```js
const projected =
  data.map(d => ({
    ...d,
    xy: projection([
      d.longitude,
      d.latitude
    ])
  }));
```

---

## 15.2 Density / contour

連続密度面:

```js
d3.contourDensity()
```

を使う方法もある。

---

## 15.3 Rasterize

数十万〜数百万点ならCanvasやserver-side rasterへ。

---

# 16. ラベル配置

ラベルは地図の美しさを大きく左右する。

Mapboxもlabelsを地図のfunctional / aesthetic elementとして扱い、位置と形状が地物との関係を伝える重要な要素だとしている。

---

## 16.1 最初は `path.centroid()`

```js
labels
  .selectAll("text")
  .data(features)
  .join("text")
  .attr(
    "transform",
    d =>
      `translate(${path.centroid(d)})`
  )
  .text(
    d => d.properties.name
  );
```

D3公式でも `path.centroid()` はstate/county labelやsymbol mapに便利とされている。

---

## 16.2 centroidの問題

例えば三日月形のpolygonではcentroidがpolygon外になることがある。

---

## 16.3 Polylabel

Mapboxのpolylabelは「polygon境界から最も遠い内部点」を高速に求め、polygon label配置に利用できる。

https://github.com/mapbox/polylabel

```js
import polylabel from "polylabel";

const p =
  polylabel(
    feature.geometry.coordinates,
    0.01
  );
```

---

## 16.4 Halo

背景と文字のコントラストを確保する。

SVG:

```css
.place-label {
  fill: #334155;

  paint-order: stroke;

  stroke: white;
  stroke-width: 3px;
  stroke-linejoin: round;
}
```

非常に効果が高い。

---

## 16.5 ラベルの階層

```text
国名        14px 600
主要都市    12px 600
都市        10px 500
河川        10px italic
補助地名     9px
```

全部同じfont-sizeにしない。

---

## 16.6 大文字を使いすぎない

世界地図で:

```text
UNITED STATES OF AMERICA
```

のような長いuppercaseは面積を消費する。

必要に応じletter-spacingや略称を調整。

---

## 16.7 ラベル衝突

D3自身にはMapbox GLのような高度なラベル衝突解決エンジンはない。

簡易方法:

```text
BBox collision
quadtree
force simulation
優先順位
事前計算
```

---

# 17. 注釈・コールアウト・インセットマップ

Datawrapperのmap design事例でも、注釈やplace labelは読者のorientingに重要とされている。

---

## 17.1 注目地域だけ明示する

```js
const tokyo =
  features.find(
    d => d.properties.name === "Tokyo"
  );

const [x, y] =
  path.centroid(tokyo);
```

```js
svg.append("text")
  .attr("x", x + 20)
  .attr("y", y - 20)
  .text("東京");
```

---

## 17.2 Leader line

```js
svg.append("line")
  .attr("x1", x)
  .attr("y1", y)
  .attr("x2", x + 18)
  .attr("y2", y - 14)
  .attr("stroke", "#64748b");
```

Datawrapperでもcallout lineは、密集した地図でlabelを離して配置しつつ対象地点との対応を保つ方法として紹介されている。

---

## 17.3 Inset Map

詳細地域へcropすると地理的文脈を失いやすい。

```text
メイン: 関東
Inset: 日本全体
```

という構成にする。

Datawrapperもcropped map / zoom mapにinsetを使い、読者がbig pictureを失わないようにする方法を紹介している。

---

# 18. グラティキュール・海・背景

## 18.1 Sphereを描く

```js
const sphere = {
  type: "Sphere"
};

svg.append("path")
  .datum(sphere)
  .attr("fill", "#f8fafc")
  .attr("d", path);
```

これで投影法の外形が明確になる。

---

## 18.2 Graticule

```js
const graticule =
  d3.geoGraticule10();
```

```js
svg.append("path")
  .datum(graticule)
  .attr("fill", "none")
  .attr("stroke", "#cbd5e1")
  .attr("stroke-width", 0.35)
  .attr("stroke-opacity", 0.55)
  .attr("d", path);
```

主題図では極めて薄くする。

---

## 18.3 Graticuleを入れない選択

行政界choroplethでは、graticuleが不要な場合も多い。

「地理感を出すため」というだけで追加しない。

---

# 19. TooltipとHover

## 19.1 `pointer` event

```js
features
  .on(
    "pointerenter",
    pointerEnter
  )
  .on(
    "pointermove",
    pointerMove
  )
  .on(
    "pointerleave",
    pointerLeave
  );
```

mouseだけでなくtouch / penを考慮しやすい。

---

## 19.2 Hoverで境界を強調

```js
selection
  .on("pointerenter", function() {
    d3.select(this)
      .attr(
        "stroke",
        "#0f172a"
      )
      .attr(
        "stroke-width",
        1.5
      )
      .raise();
  });
```

ただし `.raise()` すると行政界meshとの描画順に影響する。

データfillとhover outlineを分離する方が安全。

---

## 19.3 overlay path

hover対象を別レイヤーに表示:

```js
hoverLayer
  .datum(d)
  .attr("d", path)
  .attr("fill", "none")
  .attr("stroke", "#111827")
  .attr("stroke-width", 1.5);
```

これなら元のpolygon順を壊さない。

---

## 19.4 Tooltipに入れる情報

良い例:

```text
群馬県
人口密度: 303人/km²
前年比: -0.7%
```

悪い例:

```text
pref_code: 10
value: 303.234234
type: 2
```

---

# 20. ズーム・パン

D3:

```js
const zoom =
  d3.zoom()
    .scaleExtent([1, 8])
    .on("zoom", zoomed);
```

```js
svg.call(zoom);
```

```js
function zoomed(event) {
  mapLayer.attr(
    "transform",
    event.transform
  );
}
```

---

## 20.1 Zoom範囲を制限する

D3公式:

```js
zoom.scaleExtent([1, 8]);
```

---

## 20.2 Pan範囲を制限する

```js
zoom.translateExtent([
  [0, 0],
  [width, height]
]);
```

無限に地図を画面外へ飛ばせないようにする。

---

## 20.3 FeatureへZoom

D3公式Observable例でよく使われる:

```js
const [[x0, y0], [x1, y1]] =
  path.bounds(feature);

const k =
  Math.min(
    8,
    0.9 /
      Math.max(
        (x1 - x0) / width,
        (y1 - y0) / height
      )
  );

const tx =
  (x0 + x1) / 2;

const ty =
  (y0 + y1) / 2;

svg.transition()
  .duration(650)
  .call(
    zoom.transform,
    d3.zoomIdentity
      .translate(
        width / 2,
        height / 2
      )
      .scale(k)
      .translate(
        -tx,
        -ty
      )
  );
```

`path.bounds()` はD3公式でもfeatureへzoomする用途として挙げられている。

---

## 20.4 Wheel zoomを強制しない

地図上でmouse wheelを奪うとページスクロールを妨害する。

D3公式のzoom documentationでも、scale limitに達したときwheelを無視する挙動はページスクロールを可能にするためのものと説明されている。

Webページ内の小地図では特に重要。

---

# 21. レスポンシブ対応

基本:

```js
const svg =
  d3.create("svg")
    .attr(
      "viewBox",
      [0, 0, width, height]
    )
    .attr(
      "style",
      "max-width:100%;height:auto;"
    );
```

---

## 21.1 projectionを再fitする

コンテナサイズが大きく変わる場合:

```js
const observer =
  new ResizeObserver(entries => {

    const width =
      entries[0]
        .contentRect
        .width;

    render(width);
  });
```

---

## 21.2 モバイルは単なる縮小ではない

```js
const mobile =
  width < 540;
```

モバイルでは:

```text
ラベル数を減らす
凡例を下へ移す
注釈を短くする
insetを消す
tooltipをtap対応
zoom UIを簡略化
```

などを行う。

---

# 22. SVG・Canvas・タイルの使い分け

## SVG

向く:

```text
国・県・市町村程度
数百〜数千feature
ラベル
annotation
hover
DOM操作
```

---

## Canvas

向く:

```text
数千〜数十万feature
大量point
頻繁な更新
```

D3 `geoPath().context(context)` を使える。

---

## Raster Tile

背景地図など。

D3の `d3-tile` collectionには:

```text
Raster tiles
Zoomable map tiles
Canvas raster tiles
Clipped tiles
```

などの例がある。

---

## Vector Tile

市街地レベルの道路やPOIを扱う場合:

```text
MVT
d3-tile
@mapbox/vector-tile
pbf
```

の組み合わせが使える。

ObservableにはMapbox Vector TilesをD3で描画する実例がある。

---

## Hybrid

実務では:

```text
Canvas:
  大量ポイント
  raster-like layers

SVG:
  行政界
  labels
  annotations
  interactive overlay
```

が非常に強い。

---

# 23. 地図を高速化する

## 23.1 最初にgeometryを減らす

最も効く。

```text
元Shapefile
↓
simplify
↓
TopoJSON
↓
gzip
```

---

## 23.2 属性を削る

GeoJSONに:

```json
{
  "name": "...",
  "code": "...",
  "population": "...",
  "dozens_of_unused_fields": "..."
}
```

を残さない。

Mapshaper:

```bash
-filter-fields name,code
```

などを利用。

---

## 23.3 境界はmesh

数千polygonへ全strokeするより:

```js
topojson.mesh()
```

---

## 23.4 precisionを必要以上に上げない

D3 projectionにはadaptive resampling precisionがある。

```js
projection.precision(0.5);
```

D3公式ではデフォルト約0.707px。

通常はデフォルトで十分。

---

## 23.5 Zoomレベル別にgeometryを変える

```text
z0–4   coarse
z5–8   medium
z9+    detailed
```

本格的なWeb mapではvector tile化も検討する。

---

# 24. アクセシビリティ

W3C WAIは地図をcomplex imageの例として挙げ、短い説明だけでなく、必要に応じてessential informationをテキストでも提供することを推奨している。

---

## 24.1 SVGへaccessible name

```html
<svg
  role="img"
  aria-labelledby="map-title map-desc"
>
  <title id="map-title">
    都道府県別人口増減率
  </title>

  <desc id="map-desc">
    首都圏と一部大都市圏では人口が増加し、
    多くの地方では人口が減少している。
  </desc>
</svg>
```

---

## 24.2 地図の要点を文章でも提供

```html
<p>
  増加率が最も高い地域は...
</p>
```

mapだけを唯一の情報源にしない。

---

## 24.3 データ表

```html
<details>
  <summary>
    地図データを表で表示
  </summary>

  <table>
    ...
  </table>
</details>
```

---

## 24.4 色だけに依存しない

```text
色
pattern
outline
symbol
text
```

を組み合わせる。

---

## 24.5 Keyboard

クリック可能なregionなら:

```js
.attr("tabindex", 0)
```

ただし数千region全部をtab対象にするのは逆効果。

検索UIや一覧を併設する方がよい場合もある。

---

# 25. 再利用可能な世界地図テンプレート

```js
function worldMap(
  world,
  {
    width = 960,
    height = 560
  } = {}
) {

  const padding = 24;

  // TopoJSONからGeoJSONへ変換
  const countries =
    topojson.feature(
      world,
      world.objects.countries
    );

  const land =
    topojson.feature(
      world,
      world.objects.land
    );

  // 内部国境
  const borders =
    topojson.mesh(
      world,
      world.objects.countries,
      (a, b) => a !== b
    );

  // 世界地図ではEqual Earthを基本候補とする
  const projection =
    d3.geoEqualEarth()
      .fitExtent(
        [
          [
            padding,
            padding
          ],
          [
            width - padding,
            height - padding
          ]
        ],
        {
          type: "Sphere"
        }
      );

  const path =
    d3.geoPath(projection);

  const svg =
    d3.create("svg")
      .attr(
        "viewBox",
        [0, 0, width, height]
      )
      .attr(
        "style",
        `
          max-width:100%;
          height:auto;
          background:#fff;
        `
      )
      .attr(
        "role",
        "img"
      )
      .attr(
        "aria-label",
        "World map"
      );

  // -----------------------------
  // Ocean / sphere
  // -----------------------------

  svg.append("path")
    .datum({
      type: "Sphere"
    })
    .attr(
      "fill",
      "#f8fafc"
    )
    .attr(
      "stroke",
      "#cbd5e1"
    )
    .attr(
      "stroke-width",
      0.7
    )
    .attr(
      "d",
      path
    );

  // -----------------------------
  // Graticule
  // -----------------------------

  svg.append("path")
    .datum(
      d3.geoGraticule10()
    )
    .attr(
      "fill",
      "none"
    )
    .attr(
      "stroke",
      "#cbd5e1"
    )
    .attr(
      "stroke-opacity",
      0.35
    )
    .attr(
      "stroke-width",
      0.35
    )
    .attr(
      "d",
      path
    );

  // -----------------------------
  // Land
  // -----------------------------

  svg.append("path")
    .datum(land)
    .attr(
      "fill",
      "#e2e8f0"
    )
    .attr(
      "d",
      path
    );

  // -----------------------------
  // Countries
  // -----------------------------

  svg.append("g")
    .selectAll("path")
    .data(
      countries.features
    )
    .join("path")
    .attr(
      "fill",
      "transparent"
    )
    .attr(
      "d",
      path
    )
    .append("title")
    .text(
      d =>
        d.properties.name ??
        d.id
    );

  // -----------------------------
  // Borders
  // -----------------------------

  svg.append("path")
    .datum(borders)
    .attr(
      "fill",
      "none"
    )
    .attr(
      "stroke",
      "#ffffff"
    )
    .attr(
      "stroke-width",
      0.55
    )
    .attr(
      "stroke-linejoin",
      "round"
    )
    .attr(
      "d",
      path
    );

  return svg.node();
}
```

---

# 26. 再利用可能なコロプレス実装

```js
function choroplethMap(
  topology,
  values,
  {
    objectName = "countries",

    width = 960,
    height = 560,

    value = d => d.value,
    id = d => d.id,

    noDataColor = "#e5e7eb",

    thresholds = [
      5,
      10,
      20,
      30
    ],

    colors =
      d3.schemeBlues[5]
  } = {}
) {

  const features =
    topojson.feature(
      topology,
      topology.objects[
        objectName
      ]
    );

  const borders =
    topojson.mesh(
      topology,
      topology.objects[
        objectName
      ],
      (a, b) =>
        a !== b
    );

  const valueMap =
    new Map(
      values.map(
        d => [
          id(d),
          value(d)
        ]
      )
    );

  const color =
    d3.scaleThreshold()
      .domain(
        thresholds
      )
      .range(
        colors
      );

  const projection =
    d3.geoEqualEarth()
      .fitExtent(
        [
          [20, 20],
          [
            width - 20,
            height - 20
          ]
        ],
        features
      );

  const path =
    d3.geoPath(
      projection
    );

  const svg =
    d3.create("svg")
      .attr(
        "viewBox",
        [0, 0, width, height]
      )
      .attr(
        "style",
        "max-width:100%;height:auto;"
      );

  // データpolygon
  const regions =
    svg.append("g")
      .selectAll("path")
      .data(
        features.features
      )
      .join("path")
      .attr(
        "fill",
        d => {

          const v =
            valueMap.get(d.id);

          if (
            v == null ||
            !Number.isFinite(v)
          ) {
            return noDataColor;
          }

          return color(v);
        }
      )
      .attr(
        "d",
        path
      );

  // Tooltip fallback
  regions
    .append("title")
    .text(d => {

      const v =
        valueMap.get(d.id);

      const name =
        d.properties.name ??
        d.id;

      return v == null
        ? `${name}: No data`
        : `${name}: ${v}`;
    });

  // 境界はmeshで一度だけ描画
  svg.append("path")
    .datum(
      borders
    )
    .attr(
      "fill",
      "none"
    )
    .attr(
      "stroke",
      "#fff"
    )
    .attr(
      "stroke-width",
      0.65
    )
    .attr(
      "stroke-linejoin",
      "round"
    )
    .attr(
      "pointer-events",
      "none"
    )
    .attr(
      "d",
      path
    );

  return {
    node: svg.node(),
    projection,
    path,
    color
  };
}
```

---

# 27. 再利用可能なズーム実装

```js
function addZoom(
  svg,
  mapLayer,
  {
    width,
    height,
    maxZoom = 8
  }
) {

  const zoom =
    d3.zoom()
      .scaleExtent(
        [1, maxZoom]
      )
      .extent(
        [
          [0, 0],
          [width, height]
        ]
      )
      .translateExtent(
        [
          [0, 0],
          [width, height]
        ]
      )
      .on(
        "zoom",
        ({ transform }) => {

          mapLayer.attr(
            "transform",
            transform
          );

          mapLayer.attr(
            "stroke-width",
            1 / transform.k
          );
        }
      );

  svg.call(zoom);

  return zoom;
}
```

---

## Featureへズーム

```js
function zoomToFeature(
  svg,
  zoom,
  path,
  feature,
  width,
  height
) {

  const [
    [x0, y0],
    [x1, y1]
  ] =
    path.bounds(
      feature
    );

  const k =
    Math.min(
      8,
      0.9 /
        Math.max(
          (x1 - x0) / width,
          (y1 - y0) / height
        )
    );

  const x =
    (x0 + x1) / 2;

  const y =
    (y0 + y1) / 2;

  svg
    .transition()
    .duration(600)
    .call(
      zoom.transform,
      d3.zoomIdentity
        .translate(
          width / 2,
          height / 2
        )
        .scale(k)
        .translate(
          -x,
          -y
        )
    );
}
```

---

# 28. デザイントークン

地図スタイルをコード内で統一する。

```js
const mapTheme = {

  background:
    "#ffffff",

  ocean:
    "#f8fafc",

  land:
    "#f1f5f9",

  borders: {
    national:
      "#94a3b8",

    regional:
      "#cbd5e1",

    local:
      "#e2e8f0"
  },

  labels: {
    primary:
      "#334155",

    secondary:
      "#64748b",

    halo:
      "#ffffff"
  },

  data: {
    noData:
      "#e5e7eb",

    highlight:
      "#2563eb"
  },

  lineWidth: {
    coastline:
      0.8,

    national:
      0.7,

    regional:
      0.45,

    local:
      0.25
  }
};
```

---

# 29. よくある失敗

## NG 1: 世界地図 = Mercator

地理院地図やWeb tileで見慣れているという理由だけで採用。

### 改善

世界統計:

```js
d3.geoEqualEarth()
```

世界overview:

```js
d3.geoNaturalEarth1()
```

などを比較する。

Observableには多数のD3 projectionを比較できるProjection comparison notebookがある。

---

## NG 2: 行政界を全部黒線

```css
stroke: black;
stroke-width: 1;
```

→ 地図が「境界線の図」になる。

---

## NG 3: polygonごとにstroke

境界線が過剰に強くなる。

### 改善

TopoJSON:

```js
topojson.mesh()
```

---

## NG 4: 人口総数をchoropleth

面積と人口が混ざる。

### 改善

```text
人口密度 → choropleth
人口総数 → symbol map
```

---

## NG 5: 円の半径をlinear scale

```js
scaleLinear()
```

をradiusへ使う。

### 改善

```js
scaleSqrt()
```

---

## NG 6: 0とNo Dataが同じ

分析上かなり危険。

---

## NG 7: 10段階以上の色

人間は近い色を正確に区別しにくい。

地図で正確な値比較が必要ならchart/tableを併設する。

Datawrapperもchoroplethは大きなregional patternを見るのに向く一方、微妙な数値差を読み取る用途には向かないと説明している。

---

## NG 8: Rainbow

連続値に虹色を使うと値順序が直感的でない。

---

## NG 9: ラベル全部表示

```text
市町村全部
河川全部
道路全部
POI全部
```

→ 読めない。

---

## NG 10: 背景地図が主題データより派手

Satellite imageryや派手な道路地図の上へchoroplethを乗せると情報が競合する。

---

## NG 11: Zoomありき

閲覧者へ「自分で探してください」と丸投げしない。

静的なannotationの方が良い場合もある。

---

## NG 12: 巨大GeoJSONをそのままfetch

まず:

```text
simplify
TopoJSON
attribute削減
gzip
```

を検討。

---

## NG 13: centroidへ必ずラベル

細長いpolygonやmultipolygonで破綻する。

---

## NG 14: 地図だけで全て説明

地図 + chart + text の組み合わせの方が強いことが多い。

---

# 30. 完成前チェックリスト

## Map Purpose

- [ ] 地図である必要がある
- [ ] 読み手が見る空間パターンを説明できる
- [ ] 地図タイプが目的に合っている
- [ ] chart/tableの方が適切でないか確認した

---

## Projection

- [ ] Mercatorを惰性で選んでいない
- [ ] 世界choroplethならequal-areaを検討した
- [ ] 地域に適したprojectionを選んだ
- [ ] `fitExtent()` / `fitSize()` を検討した
- [ ] 地物の周囲にpaddingがある

---

## Geometry

- [ ] 不必要に詳細なgeometryではない
- [ ] Mapshaper等でsimplifyした
- [ ] 小島が必要ならkeep-shapesした
- [ ] topology errorを確認した
- [ ] 不要属性を削った
- [ ] TopoJSONを検討した

---

## Hierarchy

- [ ] データが最も目立つ
- [ ] 海岸線と行政界の強さが違う
- [ ] 国境と県境の強さが違う
- [ ] 背景地図が主題データと競合していない
- [ ] grid / graticuleが強すぎない

---

## Choropleth

- [ ] 絶対数ではなくrelative valueを使っている
- [ ] 色階級が説明可能
- [ ] threshold / quantile / quantizeを意図的に選んだ
- [ ] 時系列比較ならbreakを固定する必要を検討した
- [ ] No Dataと0を区別した
- [ ] 凡例にNo Dataを表示した

---

## Color

- [ ] sequential / diverging / qualitativeを使い分けた
- [ ] 基準値があるならdivergingを検討した
- [ ] rainbowを避けた
- [ ] 高彩度色を使いすぎていない
- [ ] 色だけで状態を伝えていない

---

## Symbols

- [ ] proportional circleのradiusにsqrt scaleを使った
- [ ] 大きなcircleから描いて小circleを前にした
- [ ] 重なりが読めるopacity
- [ ] symbol legendがある

---

## Labels

- [ ] 重要地名だけ表示した
- [ ] text haloがある
- [ ] font hierarchyがある
- [ ] label collisionを確認した
- [ ] centroidが不自然ならpolylabel等を検討した

---

## Annotation

- [ ] 見てほしい場所が一目で分かる
- [ ] 必要ならcallout lineを使った
- [ ] cropした地図にはinsetを検討した
- [ ] 出典・日時・単位を記載した

---

## Interaction

- [ ] hoverしなくても基本メッセージが伝わる
- [ ] pointer eventを使った
- [ ] tooltipに不要な内部IDを出していない
- [ ] zoom範囲を制限した
- [ ] pan範囲を制限した
- [ ] wheel zoomがページscrollを妨害していない

---

## Responsive

- [ ] `viewBox` がある
- [ ] mobileで確認した
- [ ] mobileでlabelを減らした
- [ ] legend位置を確認した
- [ ] annotationが画面外へ出ない

---

## Performance

- [ ] feature数を把握している
- [ ] geometry vertex数を把握している
- [ ] SVGが適切か確認した
- [ ] 大量pointならCanvas / hexbinを検討した
- [ ] タイル化を検討した
- [ ] `topojson.mesh()` を使える場所がないか確認した

---

## Accessibility

- [ ] `<title>` / `<desc>` またはARIAがある
- [ ] 地図の結論を文章でも伝えている
- [ ] 必要ならtableを併設した
- [ ] 色だけに依存していない
- [ ] interactive mapのkeyboard操作を検討した

---

# 31. 参考資料

## D3公式

### d3-geo
https://d3js.org/d3-geo

Projection、spherical GeoJSON、adaptive sampling、antimeridianなどD3地図の基礎。

### Paths
https://d3js.org/d3-geo/path

`geoPath()`、`path.bounds()`、`path.centroid()`、Canvas context。

### Projections
https://d3js.org/d3-geo/projection

`fitExtent()`、`fitSize()`、`rotate()`、`clipAngle()`、`precision()`。

### Cylindrical projections
https://d3js.org/d3-geo/cylindrical

Mercator、Equal Earth、Natural Earthなど。

### Conic projections
https://d3js.org/d3-geo/conic

Albers、conic equal-area / conformal / equidistant。

### d3-zoom
https://d3js.org/d3-zoom

Zoom / Pan、`scaleExtent()`、`translateExtent()`。

### Threshold scales
https://d3js.org/d3-scale/threshold

任意の閾値で連続値を離散クラスへ変換。

### d3-scale-chromatic
https://d3js.org/d3-scale-chromatic

Sequential / diverging / categorical palette。

---

## Observable / D3 Examples

### Projection Comparison
https://observablehq.com/@d3/projection-comparison

多数の地図投影を比較できる。

### Equal Earth
https://observablehq.com/@d3/equal-earth

### Natural Earth
https://observablehq.com/@d3/natural-earth

### Choropleth
https://observablehq.com/notebook-kit/ex/d3/choropleth

TopoJSON、quantize scale、state meshを使った典型的choropleth。

### Zoom to bounding box
https://observablehq.com/notebook-kit/ex/d3/zoom-to-bounding-box

`path.bounds()` と `d3.zoom()` でfeatureへzoom。

### Hexbin Map
https://observablehq.com/notebook-kit/ex/d3/hexbin-map

大量pointの地理的集約。

### Bubble Map
https://observablehq.com/@d3/bubble-map/2

`scaleSqrt()` を使ったproportional symbol map。

### d3-tile collection
https://observablehq.com/collection/@d3/d3-tile

Raster tiles、vector tiles、zoomable maps。

### Mapbox Vector Tiles / D3
https://observablehq.com/@d3/mapbox-vector-tiles

D3 + d3-tile + MVTの実装例。

---

## TopoJSON

### TopoJSON
https://github.com/topojson/topojson

共有arcによるtopology encoding、quantization、simplification。

### topojson-client
https://github.com/topojson/topojson-client

`feature()`、`mesh()`、`merge()`、`neighbors()`。

### world-atlas
https://github.com/topojson/world-atlas

Natural Earth由来の世界TopoJSON。

---

## Mapshaper

### Mapshaper
https://mapshaper.org/

### Mapshaper GitHub
https://github.com/mbloch/mapshaper

### Simplification Guide
https://mapshaper.org/docs/guides/simplification.html

Weighted Visvalingam、Douglas-Peucker、keep-shapes、resolution指定など。

### Command Line
https://github.com/mbloch/mapshaper/blob/master/docs/essentials/command-line.md

Web map向け前処理pipelineの参考。

---

## Cartographic Design / Datawrapper

### What to consider when creating choropleth maps
https://www.datawrapper.de/blog/choroplethmaps

choroplethはrelative data、地域パターンの把握に向くこと、色schemeなどの実践的な解説。

### Stepped color scales
https://www.datawrapper.de/academy/how-to-customize-stepped-color-scales

Linear、Quantile、Rounded、Natural Breaks、Customなどの分類。

### Map color legends
https://www.datawrapper.de/academy/maps-how-to-create-a-custom-map-key

地図凡例の設計。

### Place labels
https://www.datawrapper.de/blog/place-labels-in-choropleth-symbol-maps

地図上のorientationを助けるplace labels。

### Cropped view and inset maps
https://www.datawrapper.de/blog/cropped-view-inset-maps

crop / zoom時にgeographic contextを維持するinset map。

### Callout lines
https://www.datawrapper.de/blog/locator-maps-callout-lines-swoopy-arrows

混雑した地図でleader / callout lineを使う考え方。

### Pattern overlays
https://www.datawrapper.de/blog/pattern-overlay-in-choropleth-maps

missing / incompleteなど色以外の状態をpatternで重ねる考え方。

### Canvas map rendering
https://www.datawrapper.de/blog/choropleth-symbol-maps-easier-faster-better-looking/

大規模mapでSVGからCanvasへ移行した事例。

---

## Mapbox

### Map design and styles
https://docs.mapbox.com/help/dive-deeper/map-design/

ベースマップ、style、layer構造の基本。

### Labels in Studio
https://www.mapbox.com/blog/labels-in-studio-de28e

labelの位置・形状・地物との関係について。

### Polylabel
https://github.com/mapbox/polylabel

polygon内のlabel placementに適したpole of inaccessibilityを求めるアルゴリズム。

---

## Accessibility

### W3C WAI — Complex Images
https://www.w3.org/WAI/tutorials/images/complex/

Mapをcomplex imageとして扱い、短い説明 + 詳細なtext equivalentを提供する考え方。

---

# 最終的な考え方

D3.jsで美しい地図を作るとは、

```text
GeoJSONをpathへ変換して
色を塗る
```

ことではない。

良い地図は、

```text
何を伝えるか
↓
地図が適切か
↓
地理単位
↓
投影法
↓
geometry detail
↓
visual hierarchy
↓
color scale
↓
classification
↓
boundaries
↓
labels
↓
annotations
↓
interaction
↓
performance
↓
accessibility
```

の順で考える。

特にD3では既製のベースマップスタイルに縛られないため、

> **境界線をどこまで弱めるか、どの地名だけを残すか、どの投影法でどの地域を強調するかまで、地図そのものを情報デザインとして設計できる**

ことが最大の強みになる。

そして「美しい地図」は、装飾が多い地図ではない。

```text
必要な地理情報だけが残り、
主題データが最も強く、
読者が迷わず意味を読み取れる地図
```

が、D3.jsで目指すべき地図である。
