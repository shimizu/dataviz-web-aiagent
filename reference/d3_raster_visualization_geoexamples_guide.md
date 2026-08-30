# D3.jsでラスターを可視化する実践ノウハウ
## geoexamples.com「D3js raster tools docs」のExamplesをコードレベルで読み解く

調査対象:

- https://geoexamples.com/d3-raster-tools-docs/
- GitHub: https://github.com/rveciana/d3-raster-tools-docs

> この資料は、上記サイトの本文だけでなく `code_samples` のExamplesを確認し、  
> 「D3でラスターをどう扱うか」という実装パターンを抽出・再整理したもの。
>
> 元サイトは主に **D3 v4 時代のコード**で書かれているため、後半では2026年時点で使いやすい形に置き換えた実装方針も示す。

---

# 1. このサイトから得られる最も重要な考え方

D3はGeoTIFFそのものを「ラスター地図レイヤー」として扱うライブラリではない。

このサイトの実装では、

```text
GeoTIFF
  ↓
数値配列として読み込む
  ↓
GeoTransformでピクセルと地理座標を対応付ける
  ↓
D3 projectionで画面座標と経緯度を対応付ける
  ↓
Canvas / SVGへ描画
```

という構成を取っている。

特に重要なのは、ラスターをD3の任意投影法で描くために、

```text
画面ピクセル
   ↓
projection.invert()
   ↓
経度・緯度
   ↓
必要ならproj4でラスターCRSへ変換
   ↓
逆GeoTransform
   ↓
GeoTIFFのピクセル座標
   ↓
ラスター値取得
   ↓
RGBAへ変換
   ↓
Canvas ImageData
```

という**逆方向のサンプリング**を行うことである。

これがこのチュートリアル全体を理解する鍵になる。

---

# 2. ラスター処理の基本モデル

サイトではラスターを基本的に2次元配列として扱う。

概念的には、

```js
data[y][x]
```

で値を取得する。

元のGeoTIFF.jsが返すデータは1次元配列なので、Exampleでは、

```text
index = x + y * width
```

で2次元配列へ変換している。

ただし現在のJavaScriptでパフォーマンスを重視するなら、必ずしも2次元配列へ変換する必要はない。

例えば、

```js
const value = raster[x + y * rasterWidth];
```

のまま扱う方が、

- メモリ消費が少ない
- 配列生成コストが小さい
- TypedArrayをそのまま利用できる
- キャッシュ局所性がよい

というメリットがある。

したがって、サイトの

```text
GeoTIFF TypedArray
↓
Array<Array<number>>
```

という変換は**理解しやすさ優先の実装**と考えた方がよい。

---

# 3. GeoTIFFをD3で扱うときのGeoTransform

## 3.1 GeoTransformとは

ラスターのピクセル座標と地理座標を結びつけるアフィン変換である。

GDAL形式では6要素で表される。

```text
Xgeo = GT0 + Xpixel * GT1 + Ypixel * GT2
Ygeo = GT3 + Xpixel * GT4 + Ypixel * GT5
```

一般的なNorth-up rasterでは回転項が0なので、

```text
Xgeo = GT0 + Xpixel * GT1
Ygeo = GT3 + Ypixel * GT5
```

となる。

典型的には、

```text
GT0 = 左端X
GT1 = ピクセル幅
GT2 = 0
GT3 = 上端Y
GT4 = 0
GT5 = -ピクセル高さ
```

となる。

Y方向が負になる理由は、

```text
ラスター配列
上
↓ y増加

地理座標
上
↑ y増加
```

だからである。

---

# 4. 逆GeoTransformが非常に重要

D3でラスターを描画する場合、GeoTransformそのものより**逆変換**を頻繁に使う。

地理座標からラスター座標を取得する。

```text
Xpixel = (Xgeo - GT0) / GT1
Ypixel = (Ygeo - GT3) / GT5
```

コードとしては概念的に、

```js
function geoToPixel(x, y, gt) {
  return [
    (x - gt[0]) / gt[1],
    (y - gt[3]) / gt[5],
  ];
}
```

となる。

これによって、

```text
lon / lat
↓
raster x / y
↓
raster value
```

を取得できる。

---

# 5. D3ラスター描画の核心: output-driven rendering

サイトの「Drawing raster data」「Raster interpolation」Exampleで最も重要なのは、

**元ラスターを順番に画面へ描くのではなく、出力Canvasの各ピクセルから元ラスターを逆引きする**

という設計である。

つまり、

```text
for each screen pixel:
    screen → geographic coordinate
    geographic coordinate → raster pixel
    raster pixel → value
    value → color
```

と処理する。

概念コード:

```js
for (let y = 0; y < canvasHeight; y++) {
  for (let x = 0; x < canvasWidth; x++) {

    const lonLat = projection.invert([x, y]);

    if (!lonLat) continue;

    const [px, py] = geoToPixel(
      lonLat[0],
      lonLat[1],
      geoTransform
    );

    const value = sampleRaster(px, py);

    setPixelColor(x, y, value);
  }
}
```

この方式には重要なメリットがある。

### 任意のD3 projectionへ投影できる

例えば、

```js
d3.geoMercator()
d3.geoAzimuthalEqualArea()
d3.geoConicConformal()
d3.geoOrthographic()
```

などへラスターを直接描ける。

### 投影後に穴ができにくい

元ラスターの各セルを前向きに投影すると、

```text
source pixel
↓
projection
↓
screen
```

となるが、投影変形により画面側に隙間ができることがある。

逆に、

```text
screen
↓
inverse projection
↓
source raster
```

なら、出力ピクセルごとに値を決定できる。

これは一般的な**inverse mapping / backward mapping**と同じ考え方である。

---

# 6. D3 projection.invert() の使い方

例えば画面上の、

```text
x = 320
y = 240
```

について、

```js
const lonLat = projection.invert([320, 240]);
```

を実行すると、

```text
[longitude, latitude]
```

を取得できる。

したがって、

```text
Canvas pixel
    ↓
D3 projection.invert
    ↓
lon / lat
```

という橋渡しができる。

ラスターがWGS84経緯度なら、この値をそのまま逆GeoTransformへ渡せる。

---

# 7. 最近傍法によるラスター描画

サイトの「Raster original pixels」は、最も単純なサンプリングを行う。

```text
screen pixel
↓
lon/lat
↓
floating raster coordinate
↓
round()
↓
nearest raster cell
```

という処理である。

概念実装:

```js
function nearestSample(raster, width, height, px, py, noData = NaN) {
  const x = Math.round(px);
  const y = Math.round(py);

  if (
    x < 0 || x >= width ||
    y < 0 || y >= height
  ) {
    return noData;
  }

  return raster[x + y * width];
}
```

### 向いているデータ

- 土地被覆分類
- クラスID
- カテゴリラスター
- マスク
- 元ピクセルをそのまま見せたい場合

### 弱点

連続値の場合、

- ギザギザ
- ブロック感
- 投影変換後のジャギー

が目立つ。

---

# 8. Bilinear interpolation

サイトの「Raster interpolation」Exampleでは、4近傍を使ったbilinear interpolationを行っている。

ラスター座標が、

```text
px = 10.3
py = 20.7
```

なら、

```text
(10,20) ---- (11,20)
   |            |
   |    P       |
   |            |
(10,21) ---- (11,21)
```

の4セルを使う。

概念実装:

```js
function bilinearSample(raster, width, height, px, py, noData = NaN) {
  const x0 = Math.floor(px);
  const y0 = Math.floor(py);
  const x1 = x0 + 1;
  const y1 = y0 + 1;

  if (
    x0 < 0 || y0 < 0 ||
    x1 >= width || y1 >= height
  ) {
    return noData;
  }

  const tx = px - x0;
  const ty = py - y0;

  const v00 = raster[x0 + y0 * width];
  const v10 = raster[x1 + y0 * width];
  const v01 = raster[x0 + y1 * width];
  const v11 = raster[x1 + y1 * width];

  return (
    v00 * (1 - tx) * (1 - ty) +
    v10 * tx * (1 - ty) +
    v01 * (1 - tx) * ty +
    v11 * tx * ty
  );
}
```

### 向いているデータ

- 気温
- 気圧
- 標高
- 降水量
- SST
- NDVIなど連続量

### 向いていないデータ

土地被覆分類などカテゴリ値に補間をかけると、

```text
class 1
class 5
```

の中間として、

```text
2.7
```

のような意味のない値を作る。

カテゴリラスターは最近傍を使う。

---

# 9. Canvas ImageDataを使う理由

サイトはラスター本体の描画にSVGではなくCanvasを使用している。

これは非常に重要な判断である。

1000×1000ラスターをSVGの`rect`で描けば、

```text
1,000,000 DOM nodes
```

になる。

これは現実的ではない。

Canvasなら、

```js
const imageData = ctx.createImageData(width, height);
const rgba = imageData.data;
```

として、

```text
R
G
B
A
R
G
B
A
...
```

の配列へ直接書き込める。

各ピクセルの位置は、

```js
const offset = (y * width + x) * 4;
```

で求める。

```js
rgba[offset]     = r;
rgba[offset + 1] = g;
rgba[offset + 2] = b;
rgba[offset + 3] = a;
```

最後に、

```js
ctx.putImageData(imageData, 0, 0);
```

する。

### 重要

ラスター描画では、

```text
fillRect() × 全セル
```

より、

```text
ImageDataへ一括書込み
```

の方が基本的に高速である。

---

# 10. Exampleコードから分かる重要な改善点: RGBAインデックス

元の「Raster original pixels」Exampleでは、RGBA配列の現在位置を`pos`として持ち、ラスター範囲内のときだけ進める構造になっている。

出力画面にラスター範囲外のピクセルが含まれると、書込み位置が実際のCanvasピクセル位置とずれる可能性がある。

実装では可変`pos`に依存せず、

```js
const pos = (y * width + x) * 4;
```

と毎回計算する方が安全である。

```js
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {

    const pos = (y * width + x) * 4;

    // ...
  }
}
```

これは元Exampleをそのまま移植しない方がよいポイントの1つ。

---

# 11. Color Lookup Table（LUT）

Canvasの全ピクセルで、

```js
colorScale(value)
```

を実行すると負荷が高くなる。

サイトでは非常に面白い方法を使っている。

```text
色スケール
↓
256 × 1 の隠しCanvas
↓
gradient
↓
getImageData()
↓
RGBA Lookup Table
```

とする。

例えば256色なら、

```text
value
↓
0〜255へ正規化
↓
LUT[index]
↓
RGBA
```

で色を取得できる。

概念コード:

```js
function createColorLUT(stops, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = 1;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, size - 1, 0);

  for (const stop of stops) {
    gradient.addColorStop(stop.position, stop.color);
  }

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, 1);

  return ctx.getImageData(0, 0, size, 1).data;
}
```

値をLUT indexへ変換:

```js
function valueToLutIndex(value, min, max, size = 256) {
  const t = (value - min) / (max - min);
  return Math.round(t * (size - 1));
}
```

### この方法の利点

毎ピクセルで、

- CSS color parsing
- D3 interpolation
- RGB変換

を実行する必要がない。

### 現代的な利用方法

D3のinterpolatorから最初に256〜1024色を生成してTypedArray LUTへ入れておき、その後は整数indexで参照する方法でもよい。

---

# 12. NoDataと表示範囲外

元Exampleでは表示domain外の値に対してalphaを0にしている。

この考え方は有効である。

実用コードでは、

```js
if (
  Number.isNaN(value) ||
  value === noData ||
  value < min ||
  value > max
) {
  rgba[pos + 3] = 0;
  continue;
}
```

のように扱う。

ただし、

```text
表示domain外
```

と、

```text
NoData
```

は本来別概念である。

例えば気温なら、

```text
min=-20
max=50
```

を超える値を透明にするより、color scaleをclampして端色へ寄せる方がよいケースも多い。

---

# 13. 投影済みGeoTIFF

サイトの中でも特に重要なのが「Projected GeoTIFF」のExamplesである。

ラスターがWGS84ではなく、

- Lambert Conformal Conic
- UTM
- Web Mercator
- その他投影座標系

の場合、

```text
projection.invert()
```

から得られる経緯度を直接GeoTransformへ渡すことはできない。

必要な処理は、

```text
screen
↓
D3 projection.invert
↓
lon/lat
↓
proj4 forward
↓
GeoTIFF CRS座標
↓
inverse GeoTransform
↓
raster x/y
```

となる。

概念コード:

```js
const rasterProjection = proj4(rasterCrs);

function screenToRasterPixel(x, y) {
  const lonLat = projection.invert([x, y]);

  if (!lonLat) return null;

  const rasterCoord = rasterProjection.forward(lonLat);

  return [
    (rasterCoord[0] - gt[0]) / gt[1],
    (rasterCoord[1] - gt[3]) / gt[5],
  ];
}
```

---

# 14. proj4オブジェクトはループ外で作る

サイトのProjection解説でも重要な最適化として触れられている。

悪い例:

```js
for (...) {
  const xy = proj4(crs).forward(lonLat);
}
```

良い例:

```js
const transform = proj4(crs);

for (...) {
  const xy = transform.forward(lonLat);
}
```

ラスター描画では、

```text
width × height
```

回投影変換を行うため、投影オブジェクトの生成を内側ループへ入れるべきではない。

例えば800×600でも、

```text
480,000回
```

処理される。

---

# 15. CRS変換とラスター再投影の2つの戦略

サイトでは2つの選択肢が示されている。

## 方法A: 事前にGDALで再投影

```text
GeoTIFF
↓
gdalwarp
↓
EPSG:4326 GeoTIFF
↓
D3
```

メリット:

- ブラウザ処理が軽い
- 実装が単純
- CRS処理をGDALへ任せられる

デメリット:

- 事前処理が必要
- 再サンプリングが発生する
- 元解像度が低いと差が見えやすい

## 方法B: ブラウザでオンザフライ変換

```text
screen
↓
D3 inverse projection
↓
proj4
↓
source raster
```

メリット:

- 元GeoTIFFをそのまま使用可能
- 任意のD3投影へ動的に表示可能
- サーバー側処理不要

デメリット:

- CPU負荷が大きい
- ピクセルごとの投影計算が必要

---

# 16. Isolines

Isolineは同じ値を結ぶ線。

例えば、

- 等圧線
- 等温線
- 等高線

など。

サイトでは`raster-marching-squares`を利用し、

```text
Raster matrix
+
GeoTransform
+
threshold values
↓
GeoJSON lines
```

へ変換している。

つまり一度ベクタ化する。

```text
Raster
↓
Marching Squares
↓
GeoJSON
↓
d3.geoPath()
```

これにより、

- Canvas
- SVG

のどちらでも描画できる。

### 基本構成

```js
const thresholds = [980, 990, 1000, 1010, 1020];

const contours = rastertools.isolines(
  data,
  geoTransform,
  thresholds
);
```

生成されたGeometryを、

```js
const path = d3.geoPath(projection);
```

で描画する。

---

# 17. Isobands

Isobandは、

```text
14〜17℃
17〜20℃
20〜23℃
...
```

のような値域をPolygon化したもの。

Rasterの連続グラデーションより情報量を減らし、

```text
どの範囲に属するか
```

を読みやすくする。

サイトでは、

```text
Raster
↓
rastertools.isobands()
↓
GeoJSON Polygon
↓
D3 path
```

としている。

### SVGのメリット

isobandをSVG path化すると、

```js
selection
  .on("pointerenter", ...)
  .on("click", ...)
```

などをFeature単位で行いやすい。

したがって、

```text
Raw raster      → Canvas
Isoline/Isoband → SVG
```

というハイブリッド構成は実用的である。

---

# 18. Isolineのラベル

サイトのExamplesの中でも面白い実装。

Canvasには、

```text
Pathの50%地点
Pathの接線方向
Path長
```

を直接取得するAPIがない。

そこで、

```text
GeoJSON
↓
D3 geoPath
↓
SVG path string
↓
svg-path-properties
↓
length / point / tangent
```

という処理を行う。

### ラベル配置

例えば、

```text
150px間隔
```

で線上にラベルを配置する。

```text
path length
↓
position at length
↓
x/y
+
tangent
↓
label rotation
```

という構成。

---

# 19. Canvasでラベル下の線を消す

等高線や等圧線では、

```text
──── 1000 ────
```

のように文字の下の線を消したい。

サイトでは、

```text
hidden Canvas
```

へまず、

- isoline
- label

を描画する。

文字を描く直前に、

```js
ctx.clearRect(...)
```

で文字の背景部分だけ線を消す。

その後、

```js
mainContext.drawImage(hiddenCanvas, 0, 0);
```

で本体Canvasへ合成する。

この**オフスクリーンCanvasによるレイヤー合成**は、ラスター可視化全体に応用できる。

---

# 20. SVGの場合はmaskを使う

SVG版では、

```text
isoline
+
mask
+
label
```

としている。

ラベルのbounding box部分をmaskで抜き、

```text
線
↓
文字部分だけ非表示
```

にする。

CanvasとSVGで同じ見た目を作る場合でも、最適な実装方法が異なることが分かる。

---

# 21. Vector field: U/Vから風速を求める

風の場合、

```text
U = east-west component
V = north-south component
```

を使う。

風速:

```text
speed = sqrt(U² + V²)
```

サイトのExampleではm/sからknotsへ変換している。

```js
const speedKt = 1.943844492 * Math.hypot(u, v);
```

JavaScriptでは現在、

```js
Math.hypot(u, v)
```

を使うと読みやすい。

---

# 22. Wind arrows

サイトでは画面上へ一定間隔のサンプリンググリッドを作る。

例えば、

```text
30px間隔
```

なら、

```js
for (let y = step; y < height; y += step) {
  for (let x = step; x < width; x += step) {
    ...
  }
}
```

とする。

各画面位置について、

```text
screen
↓
projection.invert
↓
raster x/y
↓
U/V
↓
direction
```

を計算する。

角度は概念的に、

```js
const angle = Math.atan2(-v, u);
```

としている。

### `-v` が出てくる理由

地理的なVの正方向とCanvasのY正方向が逆だからである。

```text
north
↑ +V

Canvas
↓ +Y
```

したがって座標系の符号に注意する必要がある。

---

# 23. Canvas transformを使うと矢印描画が単純になる

Exampleでは、

```js
ctx.save();
ctx.translate(x, y);
ctx.rotate(angle);
ctx.scale(scale, scale);

// arrow

ctx.restore();
```

という方法を使う。

これは非常に良いパターン。

矢印そのものは常に、

```text
→
```

方向で定義しておき、

Canvas transformで、

- 位置
- 向き
- サイズ

を変更する。

---

# 24. Wind barb

Wind barbでも基本処理は矢印と同じ。

違いは風速を、

```text
50 kt
10 kt
5 kt
```

へ分解して記号化する点。

サイトでは、

```text
speed
↓
5 kt単位へround
↓
50
10
5
```

へ分解している。

このように、

```text
scalar magnitude
+
vector direction
```

を別々に考えると実装しやすい。

---

# 25. Vector glyphは元ラスターの全セルに描かない

非常に重要。

例えば1000×1000の風ラスターに100万個の矢印を描いても読めない。

サイトでは、

```text
画面上の一定ピクセル間隔
```

でglyphを配置する。

つまりサンプリング密度を、

```text
データ解像度
```

ではなく、

```text
画面解像度
```

で決める。

これはWeb可視化では重要な原則である。

ズームレベルに応じて、

```js
step = 20;
step = 30;
step = 50;
```

など変化させるとよい。

---

# 26. Streamlines

Streamlineはベクトル場に接する曲線。

サイトでは`raster-streamlines`を使って、

```text
U raster
+
V raster
+
GeoTransform
↓
GeoJSON LineStrings
```

を生成する。

それをD3 pathで描画する。

```text
vector raster
↓
streamline calculation
↓
GeoJSON
↓
D3
```

という、ラスター→ベクター変換パターンである。

---

# 27. Streamlineへ方向矢印を付ける

Streamlineだけでは方向が分からない。

そこで、

```text
GeoJSON streamline
↓
SVG path
↓
path length
↓
中点
↓
tangent
↓
arrow
```

とする。

`svg-path-properties`を使って、

- total length
- 指定距離の座標
- tangent

を取得している。

このテクニックは、

- 流線
- 河川流向
- 海流
- 交通フロー
- 軌跡

などにも応用できる。

---

# 28. Animated streamlines

サイトの「Animated streamlines」Exampleでは、`d3.timer()`を使って矢印をPath上で移動させる。

概念:

```text
position =
    initialDistance
  + speed * elapsedTime
```

これをPath長で循環させる。

```js
const distance =
  (initial + speed * elapsed) % totalLength;
```

そして、

```text
getPointAtLength(distance)
```

相当の処理で矢印位置を求める。

---

# 29. Animated streamline Exampleのパフォーマンス改善

元Exampleではアニメーションフレーム内で各streamlineに対してpath propertiesを生成している。

静的なstreamlineなら、

- path string
- total length
- path-properties object

は毎フレーム変わらない。

したがって事前計算した方がよい。

```js
const preparedLines = lines.features.map(feature => {
  const svgPath = pathForMeasurement(feature);
  const props = new svgPathProperties(svgPath);

  return {
    feature,
    props,
    length: props.getTotalLength(),
  };
});
```

アニメーション中は、

```js
for (const line of preparedLines) {
  const p = line.props.getPropertiesAtLength(distance);
}
```

だけにする。

これは元Exampleを実運用へ持ち込む際にかなり重要な最適化。

---

# 30. Scalar raster + Vector overlay

気象データでは、

```text
背景: wind speed isobands
前景: streamlines
上: pressure isolines
```

のようなレイヤー構成がよく使われる。

サイトのVardah examplesはまさにこの構成を実演している。

例えば、

```text
Canvas
├─ basemap
├─ isobands
├─ isolines
└─ streamlines / arrows

SVG
└─ legend / controls
```

のように、用途に応じてCanvasとSVGを分けるとよい。

---

# 31. Layer selection

サイトのLayer selection Exampleでは、

```text
wind
temperature
pressure
```

を選択できる。

重要なのは、ユーザー操作ごとにデータを再読込するのではなく、

```text
Load
↓
Raster processing
↓
isobands / isolinesを生成
↓
保持
↓
drawMap()だけ再実行
```

という設計になっている点。

UI変更時は描画のみやり直す。

これは現代のWeb GISでも基本となる。

---

# 32. レイヤー切替時はCanvasをclearして再構築する

Exampleでは、

```js
context.clearRect(0, 0, width, height);
```

してから、

```text
basemap
↓
isobands
↓
isolines
```

を順番に再描画する。

CanvasはDOMノード単位の差分更新ができないので、

```text
state
↓
render(state)
```

という考え方にすると管理しやすい。

---

# 33. Offscreen canvasは再利用する

元のLayer selection Exampleは、再描画のたびに補助CanvasをDOMへappendする処理を含む。

実運用では、

```js
const offscreen = document.createElement("canvas");
```

を初期化時に1回作り、

```js
offscreenContext.clearRect(...)
```

して再利用する方がよい。

これにより、

- 不要DOM増加
- GC負荷
- メモリ増加

を防げる。

現在なら`OffscreenCanvas`も選択肢になる。

---

# 34. Legend

ExampleではD3のscaleとlegendを分離している。

重要なのは、

```text
rendering scale
```

と、

```text
legend scale
```

を同じオブジェクトにすること。

例えば、

```js
const color = d3.scaleThreshold()
  .domain(thresholds)
  .range(colors);
```

を、

```text
Map
Legend
Tooltip
```

で共用する。

これにより表示と凡例のズレを防げる。

---

# 35. Threshold / Sequential scaleの使い分け

## Continuous raster

気温、標高など:

```js
d3.scaleSequential(...)
```

向き。

## Classified raster / isobands

風速階級など:

```js
d3.scaleThreshold(...)
```

向き。

例えば、

```text
0–5
5–10
10–15
```

を明確に区切るならthreshold。

---

# 36. Shaded relief / Hillshade

DEM Exampleでは標高配列から、

```text
gradient X
gradient Y
↓
slope
aspect
↓
illumination
```

を計算する。

光源は、

```text
azimuth
altitude
```

で定義している。

### 基本式

概念的には、

```text
shade =
sin(altitude) * sin(slope)
+
cos(altitude) * cos(slope)
* cos(azimuth - aspect)
```

の形。

計算結果を、

```text
-1〜1
↓
0〜255
```

へ変換し、グレースケール画像としてCanvasへ書く。

---

# 37. Gradientは中央差分

内部セルでは、

```text
left
center
right
```

からX gradientを求める。

上下も同様。

端部は片側差分にする。

サイトではこの方法でSlope / Aspectを計算している。

---

# 38. Hillshade ExampleをGIS用途でそのまま使わない方がよい理由

元Exampleは可視化デモとしては分かりやすいが、厳密な地形解析では注意が必要。

勾配計算で、

```text
標高差
```

を使っているが、本来は、

```text
標高差 / 地上距離
```

として扱う必要がある。

つまり、

```text
dx = pixel width in metres
dy = pixel height in metres
```

を考慮する。

さらにDEMがEPSG:4326なら、

```text
1 degree longitude
```

の距離は緯度で変化する。

GISとして正確なHillshadeを作るなら、

1. DEMをメートル系投影座標へ変換する
2. pixel spacingを使ってdz/dx、dz/dyを計算する
3. slope/aspectを求める

方が安全。

元Exampleの方法は、

```text
D3でHillshadeをどう合成するか
```

を学ぶサンプルとして捉えるとよい。

---

# 39. HillshadeとHypsometric Tintの合成

Exampleでは、

```text
Elevation color raster
+
Hillshade grayscale
```

を重ねる。

つまり、

```text
標高値 → 色
地形勾配 → 明暗
```

を分離している。

この考え方は非常に有用。

例えば、

```text
Elevation
↓
hypsometric tint

DEM
↓
hillshade

両者
↓
composite
```

とすると、地形が立体的に見える。

---

# 40. Canvas clipping

Shaded relief Exampleでは行政界などのPathでCanvasをclipし、その内部だけラスターを描いている。

概念:

```js
ctx.save();

ctx.beginPath();
path(region);

ctx.clip();

ctx.drawImage(rasterCanvas, 0, 0);
ctx.drawImage(hillshadeCanvas, 0, 0);

ctx.restore();
```

この技術は、

- 国境内だけ気象ラスターを表示
- 流域内だけ標高表示
- AOI内だけ衛星画像表示

などに使える。

---

# 41. Tooltipでラスター値を取得する

ラスターをCanvasへ描くとSVGのように、

```text
各セル = DOM node
```

ではない。

したがってクリック位置から逆算する。

```text
mouse position
↓
projection.invert()
↓
lon/lat
↓
inverse GeoTransform
↓
raster x/y
↓
value
```

描画時と同じ座標変換パイプラインを使う。

概念コード:

```js
canvas.addEventListener("pointermove", event => {
  const rect = canvas.getBoundingClientRect();

  const sx = event.clientX - rect.left;
  const sy = event.clientY - rect.top;

  const lonLat = projection.invert([sx, sy]);

  if (!lonLat) return;

  const [px, py] = geoToPixel(
    lonLat[0],
    lonLat[1],
    geoTransform
  );

  const value = nearestSample(
    raster,
    rasterWidth,
    rasterHeight,
    px,
    py
  );

  // tooltip表示
});
```

---

# 42. Tooltipでは描画補間と値取得を分けて考える

表示をbilinear interpolationしていても、Tooltipで何を表示するかは別問題。

選択肢:

### 最近傍セル値

```text
実データのセル値
```

を表示。

### Bilinear値

```text
画面に見えている補間値
```

を表示。

分析用途なら前者、見た目との一致を優先するなら後者が分かりやすい。

---

# 43. SVG vs Canvas

サイトでは両方を比較している。

## Canvasが向いている

- raw raster
- interpolated raster
- hillshade
- 大量のglyph
- animation
- 高密度データ

## SVGが向いている

- isoline
- isoband
- 少数Feature
- interaction
- click / hover
- CSS styling
- transition

---

# 44. ハイブリッド構成が最も実用的

実際には、

```text
Canvas
├─ Raster
├─ Hillshade
└─ Streamline animation

SVG
├─ Boundaries
├─ Isolines
├─ Labels
├─ Legend
└─ Interaction
```

のように併用するのがよい。

例えば、

```html
<div class="map">
  <canvas class="raster"></canvas>
  <canvas class="animation"></canvas>
  <svg class="overlay"></svg>
</div>
```

と重ねる。

---

# 45. Leafletとの組み合わせ

サイトにはLeaflet Exampleもある。

ここで重要なのは、

```text
rastertools.isobands()
rastertools.isolines()
```

がGeoJSONを返すため、D3に限定されないという点。

つまり、

```text
Raster
↓
Marching Squares
↓
GeoJSON
├─ D3
├─ Leaflet
├─ MapLibre
├─ OpenLayers
└─ deck.gl
```

という使い方ができる。

Raster processingとrenderingを分離する設計として参考になる。

---

# 46. データ形式

サイトではGeoTIFF以外も比較している。

対象:

- GeoTIFF
- NetCDF
- JSON
- Base64 JSON
- raw binary
- compressed binary

その比較から得られる基本的な教訓は、

```text
数値ラスターを巨大なJSON配列で送る
```

のは効率が悪いということ。

TypedArrayへ直接変換できるバイナリ形式は高速。

---

# 47. サイト内ベンチマークの読み方

サイトのテストデータでは、概ね、

```text
GeoTIFF
→ サイズ効率が良い
→ decodeはbinaryより重い

JSON
→ サイズが大きい

Raw binary
→ decodeが非常に速い
```

という結果になっている。

ただし、このベンチマークは古いブラウザ・古いライブラリでの結果なので、絶対値ではなく、

```text
Text encodingよりbinaryが効率的
```

という設計上の傾向を見るべき。

---

# 48. 現代ではGeoTIFFを全部読む必要はない

元サイトのExampleでは、

```text
GeoTIFF全体
↓
readRasters()
```

としている。

現在のGeoTIFF.jsではwindow読込みが可能なので、表示範囲だけ取得できる。

概念:

```js
const data = await image.readRasters({
  window: [left, top, right, bottom],
  samples: [0],
});
```

さらに、

```js
width
height
resampleMethod: "bilinear"
```

を指定して読込み時にリサンプリングすることもできる。

つまり現代の実装では、

```text
巨大GeoTIFFを全部ブラウザへ展開
```

する前に、

```text
必要なwindowだけ読む
```

設計を優先する。

---

# 49. GeoTIFF.jsの現在のAPI

元サイトでは古いAPIで、

```js
GeoTIFF.parse(arrayBuffer)
```

を使っている。

現在は概ね、

```js
import { fromArrayBuffer } from "geotiff";

const tiff = await fromArrayBuffer(arrayBuffer);
const image = await tiff.getImage();
const rasters = await image.readRasters();
```

という非同期APIを使う。

remote URLなら、

```js
import { fromUrl } from "geotiff";

const tiff = await fromUrl(url);
```

も使える。

---

# 50. GeoTIFF.js側でBilinear resamplingできる

現在のGeoTIFF.jsは、

```js
await image.readRasters({
  width: targetWidth,
  height: targetHeight,
  resampleMethod: "bilinear",
});
```

のようなリサンプリングに対応している。

ただしこれは、

```text
source raster grid
→ resized raster grid
```

のリサンプリング。

サイトで行っている、

```text
arbitrary D3 projection screen pixel
→ source raster
```

とは目的が異なる。

D3の任意投影へWarpする場合は、依然として逆投影サンプリングの考え方が有効。

---

# 51. Worker / Poolを使う

現在のGeoTIFF.jsにはdecoder poolがある。

compressed GeoTIFFを読む場合、

```js
const pool = new GeoTIFF.Pool();

const rasters = await image.readRasters({
  pool
});
```

のようにWeb Workerを利用できる。

さらにD3 raster warping自体もWorkerへ移すことができる。

例えば、

```text
Main thread
├─ UI
├─ pan / zoom
└─ Canvas display

Worker
├─ projection / reprojection
├─ interpolation
├─ color mapping
└─ ImageData生成
```

という構成が有効。

---

# 52. Raster renderingを高速化する優先順位

このサイトの実装パターンから考えると、最適化は次の順番が効果的。

## 1. SVGでピクセルを描かない

```text
Raster → Canvas
```

にする。

## 2. ImageDataへ一括書込み

`fillRect()`を大量に呼ばない。

## 3. Color LUTを作る

色計算をループ外へ出す。

## 4. TypedArrayを維持する

2次元JavaScript Arrayへのコピーを避ける。

## 5. 投影オブジェクトをキャッシュ

`proj4()`をpixel loop内で作らない。

## 6. 表示範囲だけ読む

GeoTIFF window / overviewを使う。

## 7. Web Worker

大きいWarpをmain threadから外す。

## 8. ズーム中は低解像度

interaction中は粗く、停止後に高解像度描画。

---

# 53. さらに高速化: 描画解像度を落とす

Canvas表示サイズが、

```text
1200 × 800
```

でも、操作中は、

```text
600 × 400
```

で計算してCSSで拡大してもよい。

```text
pan / zoom中
→ low-resolution raster

interaction end
→ full-resolution raster
```

とする。

Web GISでは非常に有効。

---

# 54. Projection lookupをキャッシュする

ラスター値だけが時間変化し、

```text
projection
canvas size
raster geometry
```

が同じなら、

```text
screen pixel
↓
raster px/py
```

の対応は毎回同じ。

したがって最初に、

```text
lookupX[pixel]
lookupY[pixel]
```

を作っておくことができる。

その後、時系列データでは、

```text
temperature[t]
wind[t]
```

だけ差し替える。

気象アニメーションなどで非常に効く。

---

# 55. Bilinear weightもキャッシュ可能

Geometryが固定なら、

```text
x0
x1
y0
y1
tx
ty
```

も固定。

例えば、

```js
{
  i00,
  i10,
  i01,
  i11,
  w00,
  w10,
  w01,
  w11
}
```

を画面ピクセルごとに事前計算する。

時系列ラスターでは、

```text
projection calculation
+
bilinear geometry calculation
```

を各フレームで繰り返す必要がなくなる。

---

# 56. Zoom/Panとの組み合わせ

D3 zoomを使う場合、2つの方法がある。

## A. Canvas画像自体をTransformする

interaction中:

```text
既存Canvas
↓
translate/scale
```

高速。

終了時:

```text
projection update
↓
raster再描画
```

高品質。

## B. 毎イベント再Warp

高コストなので大きなラスターでは避ける。

したがって、

```text
zooming
→ transform cached image

zoomend
→ rerender raster
```

がよい。

---

# 57. D3の役割を明確にする

このサイトを読むと、D3はラスター処理エンジンではなく、

```text
Projection
Scale
Path
Interaction
Animation
Legend
```

を担当している。

RasterのdecodeはGeoTIFF.js。

ContourはMarching Squares。

CRS変換はproj4。

Streamline計算は専用ライブラリ。

つまり、

```text
D3を全部入りGISライブラリとして使わない
```

という設計がポイント。

---

# 58. ラスター可視化アーキテクチャ

実用的には次のように分ける。

```text
Data Source
  │
  ├─ GeoTIFF
  ├─ NetCDF
  └─ Binary
  │
  ▼
Raster Reader
  │
  ▼
Raster Model
  ├─ width
  ├─ height
  ├─ bands
  ├─ noData
  ├─ CRS
  └─ affine transform
  │
  ▼
Sampler
  ├─ nearest
  └─ bilinear
  │
  ▼
Renderer
  ├─ raw raster
  ├─ hillshade
  ├─ isolines
  ├─ isobands
  ├─ arrows
  └─ streamlines
  │
  ▼
D3
  ├─ projection
  ├─ scale
  ├─ legend
  ├─ zoom
  └─ interaction
```

この分離をしておけば、

```text
GeoTIFF
NetCDF
GEE export
GRIB converted data
```

などを同じレンダラーで扱える。

---

# 59. 実装用の基本インターフェース案

```ts
interface RasterBand {
  width: number;
  height: number;

  data:
    | Uint8Array
    | Uint16Array
    | Int16Array
    | Float32Array
    | Float64Array;

  noData?: number;

  geoTransform: [
    number,
    number,
    number,
    number,
    number,
    number
  ];

  crs?: string;
}
```

サンプラー:

```ts
type RasterSampler = (
  raster: RasterBand,
  x: number,
  y: number
) => number;
```

Renderer:

```ts
interface RasterRendererOptions {
  width: number;
  height: number;
  projection: d3.GeoProjection;
  colorDomain: [number, number];
}
```

こうしておけばレンダリング層を独立させられる。

---

# 60. 現代的なD3 + GeoTIFF.jsの骨格

以下は元サイトの考え方を、現在のAPIへ置き換えた簡略例。

```js
import * as d3 from "d3";
import { fromUrl } from "geotiff";

const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");

const width = canvas.width;
const height = canvas.height;

const projection = d3.geoMercator()
  .center([139.7, 35.7])
  .scale(5000)
  .translate([width / 2, height / 2]);

const tiff = await fromUrl("/data.tif");
const image = await tiff.getImage();

const [raster] = await image.readRasters({
  samples: [0],
});

const rasterWidth = image.getWidth();
const rasterHeight = image.getHeight();

const [originX, originY] = image.getOrigin();
const [resX, resY0] = image.getResolution();

const resY = Math.abs(resY0);

const geoTransform = [
  originX,
  resX,
  0,
  originY,
  0,
  -resY,
];

const output = ctx.createImageData(width, height);
const rgba = output.data;

const color = d3.scaleSequential(d3.interpolateTurbo)
  .domain([0, 40])
  .clamp(true);

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {

    const pos = (y * width + x) * 4;

    const lonLat = projection.invert([x, y]);

    if (!lonLat) {
      rgba[pos + 3] = 0;
      continue;
    }

    const px = Math.round(
      (lonLat[0] - geoTransform[0]) / geoTransform[1]
    );

    const py = Math.round(
      (lonLat[1] - geoTransform[3]) / geoTransform[5]
    );

    if (
      px < 0 || px >= rasterWidth ||
      py < 0 || py >= rasterHeight
    ) {
      rgba[pos + 3] = 0;
      continue;
    }

    const value = raster[px + py * rasterWidth];

    const c = d3.rgb(color(value));

    rgba[pos] = c.r;
    rgba[pos + 1] = c.g;
    rgba[pos + 2] = c.b;
    rgba[pos + 3] = 220;
  }
}

ctx.putImageData(output, 0, 0);
```

ただし、大規模ラスターでは毎ピクセル`d3.rgb(color(value))`を呼ばず、LUT化した方がよい。

---

# 61. 実運用向けLUT版

```js
function buildLUT(interpolator, size = 256) {
  const lut = new Uint8ClampedArray(size * 4);

  for (let i = 0; i < size; i++) {
    const c = d3.rgb(
      interpolator(i / (size - 1))
    );

    const p = i * 4;

    lut[p] = c.r;
    lut[p + 1] = c.g;
    lut[p + 2] = c.b;
    lut[p + 3] = 255;
  }

  return lut;
}
```

値:

```js
const t = (value - min) / (max - min);

const ci = Math.max(
  0,
  Math.min(
    lutSize - 1,
    Math.round(t * (lutSize - 1))
  )
);

const cp = ci * 4;
```

これならpixel loopでD3 color処理を実行しなくてよい。

---

# 62. Exampleコードを読むときに注意すべき箇所

## 62.1 Raster original pixels

範囲外pixelでRGBA位置管理がずれないよう、

```js
pos += 4
```

方式より、

```js
pos = (y * width + x) * 4
```

を推奨。

---

## 62.2 Raster interpolation

整数ピクセルへ完全一致した場合のfallback部分で、温度データのExampleなのに別の変数名を参照している箇所がある。

実装時は、

```text
sampling target raster
```

を統一しておく。

---

## 62.3 Wind arrow / barb

画面グリッドから得た`px/py`を使う前に必ずbounds checkする。

```js
if (
  px < 0 || px >= width ||
  py < 0 || py >= height
) {
  continue;
}
```

投影領域とGeoTIFF領域が完全一致するとは限らない。

---

## 62.4 Projected raster

`proj4()`の生成はループ外。

---

## 62.5 Layer selection

hidden canvasを再描画のたびに作らず再利用。

---

## 62.6 Animated streamlines

Path geometry解析をanimation frameごとに作り直さず事前計算。

---

## 62.7 Hillshade

pixel sizeを考慮した勾配へ改善する。

---

# 63. どの方法を使うべきか

| データ | 推奨表現 | Renderer |
|---|---|---|
| 気温 | interpolated raster | Canvas |
| SST | interpolated raster | Canvas |
| 降水量 | raster / isobands | Canvas / SVG |
| 気圧 | isolines | SVG / Canvas |
| 標高 | color raster + hillshade | Canvas |
| 土地被覆 | nearest-neighbor raster | Canvas |
| 風速 | isobands / raster | Canvas |
| 風向 | arrows | Canvas |
| 風向・流れ | streamlines | Canvas |
| 海流 | animated streamlines | Canvas |
| 分析用contour | isolines | SVG |
| クリック対象band | isobands | SVG |

---

# 64. D3 raster renderingの実践的な基本構成

おすすめは、

```text
GeoTIFF.js
    │
    ▼
TypedArray
    │
    ├───────────────┐
    │               │
    ▼               ▼
Raster Renderer    Raster Analysis
    │               │
    │               ├─ Isoline
    │               ├─ Isoband
    │               └─ Streamline
    │                       │
    ▼                       ▼
Canvas                  GeoJSON
                            │
                            ▼
                         D3 SVG
```

つまり、

```text
密なデータ → Canvas

意味のあるGeometry → GeoJSON → SVG
```

と分ける。

---

# 65. GIS/Web GISとして発展させるなら

このサイトの方法をさらに発展させるなら、次の構成がよい。

```text
Cloud Optimized GeoTIFF
        │
        ▼
GeoTIFF.js range request
        │
        ▼
visible window / overview
        │
        ▼
Web Worker
        │
        ├─ CRS transform
        ├─ raster sampling
        ├─ bilinear interpolation
        └─ LUT color mapping
        │
        ▼
ImageBitmap / ImageData
        │
        ▼
Canvas
        │
        ├─ D3 zoom
        ├─ SVG vector overlay
        └─ D3 legend / interaction
```

元サイトの設計思想を現代的にすると、この形になる。

---

# 66. 最重要ポイントまとめ

## 1

D3でRasterを扱う本質は、

```text
D3 projection
+
Raster coordinate transform
```

を接続すること。

## 2

任意投影へラスターを描くときは、

```text
screen pixel
→ inverse projection
→ raster pixel
```

という逆引き方式が強力。

## 3

高密度RasterはSVGではなくCanvas。

## 4

Canvasでは`ImageData`へ直接RGBAを書く。

## 5

色変換はLUT化する。

## 6

連続値はbilinear、カテゴリ値はnearest。

## 7

Projected GeoTIFFでは、

```text
D3 inverse
→ lon/lat
→ proj4
→ source CRS
→ GeoTransform
```

とする。

## 8

Isoline / Isoband / StreamlineはGeoJSON化するとD3で扱いやすい。

## 9

Raw rasterはCanvas、インタラクティブGeometryはSVGというハイブリッドが使いやすい。

## 10

Animationでは静的Geometry計算を毎frame繰り返さない。

## 11

DEM hillshadeでは、実運用時はpixel spacingとCRSを正しく考慮する。

## 12

現在のGeoTIFF.jsでは、

- async API
- window read
- resampling
- overviews
- decoder pool

を活用できるので、古いExampleをそのままコピーせず、設計思想だけ取り込むのがよい。

---

# 67. 調査した主要ページ・Examples

## 基礎

- Home  
  https://geoexamples.com/d3-raster-tools-docs/

- Reading raster data  
  https://geoexamples.com/d3-raster-tools-docs/intr/reading-raster-data.html

- GeoTransform  
  https://geoexamples.com/d3-raster-tools-docs/intr/geotransform.html

- Color scales  
  https://geoexamples.com/d3-raster-tools-docs/intr/color-scales.html

- Tooltips  
  https://geoexamples.com/d3-raster-tools-docs/intr/tooltips.html

- Projections  
  https://geoexamples.com/d3-raster-tools-docs/intr/projections.html

- Alternative raster formats  
  https://geoexamples.com/d3-raster-tools-docs/intr/raster-formats.html

## Raster

- Drawing raster data  
  https://geoexamples.com/d3-raster-tools-docs/plot/drawing-raster-data.html

- Raster original pixels example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/raster-pixels-page.html

- Raster interpolation example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/raster-interpolation-page.html

- Projected raster interpolation example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/raster-interpolation-projected-page.html

## Contour

- Isolines  
  https://geoexamples.com/d3-raster-tools-docs/plot/isolines.html

- Isoline example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/isolines-page.html

- Isoline labels example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/isolines-labels-page.html

- Isobands  
  https://geoexamples.com/d3-raster-tools-docs/plot/isobands.html

- Isobands example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/isobands-page.html

## Vector field

- Arrows and barbs  
  https://geoexamples.com/d3-raster-tools-docs/plot/arrows-and-barbs.html

- Wind arrows example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/wind-arrows-page.html

- Wind barbs example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/wind-barbs-page.html

- Projected GeoTIFF wind barbs  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/wind-barbs-projected-page.html

- Streamlines  
  https://geoexamples.com/d3-raster-tools-docs/plot/streamlines.html

- Streamline example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/streamlines-arrows-page.html

- Animated streamlines  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/vardah-streamlines-page.html

## Terrain

- Shaded relief  
  https://geoexamples.com/d3-raster-tools-docs/plot/shaded-relief.html

- Shaded relief example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/dem-shaded-page.html

- Color scale + shaded relief  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/color-scale-interpolation-page.html

## UI / integration

- Layer selection  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/vardah-layers-page.html

- Leaflet  
  https://geoexamples.com/d3-raster-tools-docs/plot/leaflet.html

- Leaflet example  
  https://geoexamples.com/d3-raster-tools-docs/code_samples/leaflet-page.html

---

# 68. 現行ライブラリ参考

## D3

https://d3js.org/

2026年8月時点でnpmのlatestはD3 7.9.0。

## GeoTIFF.js

https://github.com/geotiffjs/geotiff.js

現在は、

```js
fromUrl()
fromArrayBuffer()
getImage()
readRasters()
```

などのasync APIが中心。

特に大規模ラスターでは、

```text
window
bbox
resolution
overview
Pool / Worker
```

などを利用する価値が高い。

---

# 69. 結論

geoexamplesのD3 Raster Toolsは古いコードではあるが、ラスター可視化の設計思想として現在でも非常に参考になる。

特に価値が高いのは、

```text
Canvasを出力グリッドとして扱い、
各画面ピクセルからD3 projectionを逆変換し、
元ラスターをサンプリングする
```

という発想。

これは単なる「GeoTIFF表示」ではなく、

```text
Raster reprojection
+
resampling
+
color mapping
+
D3 projection
```

をブラウザ内で構成する方法である。

現代の実装では、

- GeoTIFF.jsのwindow / overview
- TypedArray
- Web Worker
- OffscreenCanvas
- LUT
- bilinear sampling
- projection lookup cache
- Canvas + SVG hybrid

を組み合わせることで、元サイトのExampleよりかなり高速かつ堅牢なラスター可視化エンジンへ発展させられる。
