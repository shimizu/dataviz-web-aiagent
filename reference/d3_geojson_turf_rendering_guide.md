# D3.jsでGeoJSONを地図化する際の問題とTurf.jsによる修正方法

D3.jsでGeoJSONを地図化するときは、単に `d3.geoPath()` に渡せば必ず正しく描画できるわけではありません。

実際のGISデータでは、以下のような原因によって、

- 地図が表示されない
- 全く違う場所に表示される
- Polygonの内外が反転する
- 地球全体が塗りつぶされる
- SVGの描画が極端に重くなる
- Polygonの一部が崩れる

といった問題が発生します。

このドキュメントでは、D3.jsでGeoJSONを描画するときによく発生する問題と、Turf.jsを使ってD3で扱いやすいGeoJSONへ修正・正規化する方法を整理します。

---

## 1. D3.jsでGeoJSONを描画する基本形

D3では通常、以下のようにGeoJSONを描画します。

```js
const width = 800;
const height = 600;

const projection = d3.geoMercator()
  .fitSize([width, height], geojson);

const path = d3.geoPath(projection);

svg.selectAll("path")
  .data(geojson.features)
  .join("path")
  .attr("d", path)
  .attr("fill", "#ccc")
  .attr("stroke", "#333");
```

`fitSize()` はGeoJSON全体が指定された描画領域に収まるように、投影法の `scale` と `translate` を自動調整します。

ただし、元のGeoJSONに問題があると `fitSize()` を使っても正常には描画されません。

---

## 2. よくある問題一覧

| 問題 | 主な症状 | 対策 |
|---|---|---|
| Polygonのリング方向 | 地球全体が塗られる、Polygonが反転する | `turf.rewind()` |
| 緯度・経度が逆 | 全く違う場所に表示される | `turf.flip()` |
| EPSG:3857など投影済み座標 | 巨大な座標値になり表示されない | `turf.toWgs84()` |
| 重複座標 | pathが不安定、処理が重い | `turf.cleanCoords()` |
| 自己交差Polygon | 塗りつぶしがおかしい | `turf.unkinkPolygon()` |
| 頂点数が多すぎる | SVG描画が重い | `turf.simplify()` |
| MultiPolygon | Polygon単位の処理が難しい | `turf.flatten()` |
| NaN / null / Infinity | pathが生成されない | 独自バリデーション |
| 日付変更線跨ぎ | Polygonが世界を横断する | geometry分割 / clipping |
| 投影済み座標を再投影 | 二重投影で崩れる | `geoIdentity()` またはWGS84へ変換 |

---

# 3. Polygonのリング方向

D3.jsでGeoJSONを扱う際に特に注意すべき問題です。

一般的なRFC 7946 GeoJSONでは、Polygonのリング方向は通常次のようになります。

```text
外周: counter-clockwise
穴:   clockwise
```

一方、D3の球面Geometryでは、Polygonの向きについて一般的なGeoJSONとは異なる前提を持ちます。

そのため、正常なGeoJSONをD3へ渡しても、

```text
日本だけを描画したい
        ↓
日本以外の地球全体が塗られる
```

という現象が発生する場合があります。

Turf.jsでは `rewind()` を利用できます。

```js
geojson = turf.rewind(geojson, {
  reverse: true
});
```

D3へ渡す前に次のように処理します。

```js
const d3GeoJSON = turf.rewind(geojson, {
  reverse: true
});

const projection = d3.geoMercator()
  .fitSize([width, height], d3GeoJSON);

const path = d3.geoPath(projection);
```

GeoJSONがMapbox GL JSやQGISでは正常なのに、D3だけで内外が逆になる場合は、最初にリング方向を疑う価値があります。

---

# 4. 緯度・経度が逆になっている

GeoJSONの座標順序は、

```text
[longitude, latitude]
```

です。

例えば東京なら、

```js
[139.76, 35.68]
```

となります。

しかしCSVや外部APIから作成されたGeoJSONでは、

```js
[35.68, 139.76]
```

のように、

```text
[latitude, longitude]
```

になっていることがあります。

この場合はTurf.jsの `flip()` を利用できます。

```js
geojson = turf.flip(geojson);
```

ただし、正常なGeoJSONに対して無条件に `flip()` を実行すると逆に壊れるため、元データの仕様確認が必要です。

---

# 5. EPSG:3857などの投影済み座標が入っている

D3の `geoMercator()` に通常渡すGeoJSONは、経度・緯度の座標です。

例えば、

```js
[139.76, 35.68]
```

のような値を想定します。

一方、Web Mercatorの座標では、

```js
[
  15550000,
  4250000
]
```

のような大きな値になります。

このような座標をそのまま `geoMercator()` に渡すと、正しく表示できません。

Turf.jsではWeb MercatorからWGS84への変換ができます。

```js
geojson = turf.toWgs84(geojson);
```

注意点として、`toWgs84()` は汎用的なEPSG変換関数ではありません。

例えば、

```text
EPSG:6677
EPSG:3099
EPSG:32654
```

などの座標系を変換する場合は、

- proj4
- GDAL
- ogr2ogr
- QGIS
- PostGIS

などの利用を検討します。

---

# 6. 重複座標

実際のGISデータには、以下のような重複座標が含まれることがあります。

```js
[
  [139.0, 36.0],
  [139.1, 36.1],
  [139.1, 36.1],
  [139.1, 36.1],
  [139.2, 36.2]
]
```

このような冗長座標は、

- SVG pathのサイズ増加
- 描画速度低下
- geometry処理の負荷増加

につながります。

Turf.jsの `cleanCoords()` を利用できます。

```js
geojson = turf.cleanCoords(geojson);
```

D3へ渡す前のクリーニング処理として比較的使いやすい処理です。

---

# 7. 自己交差Polygon

以下のようにPolygon自身が交差しているGeometryがあります。

```text
\ /
 X
/ \
```

このような自己交差Polygonは、SVGのfill処理やD3の球面処理で意図しない描画になることがあります。

Turf.jsでは、

```js
const fixed = turf.unkinkPolygon(polygon);
```

を利用できます。

`unkinkPolygon()` は自己交差したPolygonを複数の正常なPolygonへ分割します。

ただし、

```text
1 Feature
   ↓
複数Feature
```

になる可能性があるため、元データのFeature IDや属性との対応関係に注意が必要です。

---

# 8. MultiPolygonをPolygonへ分解する

D3自体は `MultiPolygon` をそのまま描画できます。

ただし、

- Polygon単位で色を付けたい
- Polygon単位でクリック判定したい
- Polygon単位で面積計算したい
- 島ごとに処理したい

といった場合は分解した方が扱いやすいことがあります。

Turf.jsでは、

```js
geojson = turf.flatten(geojson);
```

とすることで、

```text
MultiPolygon
    ↓
Polygon
Polygon
Polygon
```

のように展開できます。

---

# 9. 頂点数が多すぎる

行政界、海岸線、OpenStreetMap由来データなどでは、1つのPolygonに数万〜数十万頂点が含まれることがあります。

SVGで大量のpathを描画すると、

- 初期描画が遅い
- ズーム時に重い
- hoverやclickが遅い
- DOMサイズが巨大になる

といった問題が発生します。

Turf.jsでは `simplify()` を使用できます。

```js
geojson = turf.simplify(geojson, {
  tolerance: 0.001,
  highQuality: true
});
```

例えば、

```text
100,000 vertices
       ↓
5,000 vertices
```

まで削減できれば、D3のSVGレンダリング負荷を大きく下げられる場合があります。

ただし、`tolerance` はデータの縮尺や用途によって調整する必要があります。

---

# 10. NaN / null / Infinityなどの不正座標

GeoJSONのcoordinates内に、

```js
[NaN, 35.0]
[139.0, null]
[Infinity, 36.0]
```

などが混入していると、D3のpath生成が失敗する場合があります。

Turf.jsだけですべてのケースを安全に修正するのは難しいため、描画前に独自チェックを入れるのが安全です。

例:

```js
function isValidPosition(coord) {
  return (
    Array.isArray(coord) &&
    coord.length >= 2 &&
    Number.isFinite(coord[0]) &&
    Number.isFinite(coord[1])
  );
}
```

実運用ではGeometryの階層を再帰的に走査し、全座標を検査する処理を用意すると安定します。

---

# 11. 日付変更線を跨ぐGeometry

例えば、

```text
179°E
   ↓
180°
   ↓
179°W
```

のように日付変更線を跨ぐPolygonでは、D3の投影法によってPolygonが世界を横断して描画される場合があります。

この問題は単純な `rewind()` だけでは修正できません。

場合によっては、

- Geometryを180度で分割する
- longitudeを正規化する
- clippingを利用する
- 投影法を変更する

などの処理が必要です。

特に太平洋域、ロシア東部、アラスカ、フィジーなどを扱う場合は注意が必要です。

---

# 12. 投影済みGeoJSONをそのまま描画する場合

すでに画面座標や投影座標に変換済みのGeometryをD3で描画する場合、`geoMercator()` などを再適用すると二重投影になります。

この場合は、

```js
const projection = d3.geoIdentity();
```

を利用できることがあります。

例えば、

```js
const path = d3.geoPath(
  d3.geoIdentity()
);
```

とすることで、座標をほぼそのままSVG座標として利用できます。

ただしY軸方向の違いなどにより、

```js
d3.geoIdentity().reflectY(true)
```

が必要になる場合もあります。

---

# 13. D3描画前のGeoJSON正規化関数

実際のアプリケーションでは、D3へ直接GeoJSONを渡すのではなく、描画前の正規化レイヤーを作ると扱いやすくなります。

```js
function normalizeGeoJSONForD3(input, options = {}) {
  const {
    flip = false,
    webMercator = false,
    simplify = false,
    tolerance = 0.0001,
    rewind = true
  } = options;

  let geojson = structuredClone(input);

  // Web Mercator → WGS84
  if (webMercator) {
    geojson = turf.toWgs84(geojson);
  }

  // [lat, lon] → [lon, lat]
  // 元データが逆の場合のみ使用する
  if (flip) {
    geojson = turf.flip(geojson);
  }

  // 重複・冗長座標を削除
  geojson = turf.cleanCoords(geojson);

  // 必要に応じて簡略化
  if (simplify) {
    geojson = turf.simplify(geojson, {
      tolerance,
      highQuality: true
    });
  }

  // D3向けにPolygonリング方向を調整
  if (rewind) {
    geojson = turf.rewind(geojson, {
      reverse: true
    });
  }

  return geojson;
}
```

利用例:

```js
const data = normalizeGeoJSONForD3(rawGeoJSON, {
  simplify: true,
  tolerance: 0.0001
});

const width = 800;
const height = 600;

const projection = d3.geoMercator()
  .fitExtent(
    [
      [20, 20],
      [width - 20, height - 20]
    ],
    data
  );

const path = d3.geoPath(projection);

svg.selectAll("path")
  .data(data.features)
  .join("path")
  .attr("d", path)
  .attr("fill", "#ccc")
  .attr("stroke", "#333");
```

---

# 14. 無条件に実行しない方がよい処理

以下の処理は便利ですが、すべてのGeoJSONへ自動適用するのは危険です。

## turf.flip()

```js
turf.flip()
```

本当に緯度・経度が逆なのかを確認する必要があります。

正常なGeoJSONに適用すると破損します。

---

## turf.toWgs84()

```js
turf.toWgs84()
```

元データが本当にWeb Mercatorなのか確認が必要です。

WGS84のデータへ適用すると誤った座標になります。

---

## turf.unkinkPolygon()

```js
turf.unkinkPolygon()
```

自己交差を修正できますが、1 Featureが複数Featureへ分割される可能性があります。

属性管理やFeature IDとの対応関係に注意が必要です。

---

# 15. 比較的安全に適用しやすい処理

D3描画前の正規化処理として比較的組み込みやすいのは、

```js
turf.cleanCoords()
```

と、

```js
turf.rewind()
```

です。

ただし `rewind()` についても、元データと使用するD3投影法の組み合わせを確認した上で利用するのが安全です。

---

# 16. GISデータをD3へ渡す前の推奨診断フロー

```text
GeoJSON入力
   │
   ├─ JSONとして正常か
   │
   ├─ GeoJSON typeは正常か
   │
   ├─ coordinatesは有限値か
   │
   ├─ [longitude, latitude]か
   │
   ├─ 座標系はWGS84か
   │
   ├─ bboxは妥当か
   │
   ├─ Polygonは閉じているか
   │
   ├─ self intersectionはないか
   │
   ├─ ring directionはD3で問題ないか
   │
   ├─ 頂点数が多すぎないか
   │
   ▼
Turf.jsで正規化
   │
   ├─ cleanCoords()
   ├─ rewind()
   ├─ simplify()
   ├─ flatten()
   └─ 必要に応じてその他の修正
   │
   ▼
projection.fitExtent()
   │
   ▼
d3.geoPath()
   │
   ▼
SVG / Canvas
```

---

# 17. 問題切り分けの実践的な順序

D3でGeoJSONが正常に描画されない場合、以下の順番で確認すると効率的です。

## 1. coordinatesを見る

```js
console.log(geojson.features[0].geometry.coordinates);
```

まず座標値の桁を確認します。

### 正常な経緯度の例

```text
139.7
35.6
```

### Web Mercatorらしい値

```text
15500000
4200000
```

---

## 2. bboxを確認する

Turf.jsなら、

```js
const bbox = turf.bbox(geojson);

console.log(bbox);
```

例えば日本なら概ね、

```text
[122, 20, 154, 46]
```

付近になるはずです。

もし、

```text
[20, 122, 46, 154]
```

のようになっていれば、緯度・経度が逆になっている可能性があります。

---

## 3. Polygonのリング方向を疑う

以下の症状の場合、

- Polygonの中ではなく外側が塗られる
- 地球全体が塗られる
- Mapboxでは正常だがD3ではおかしい

リング方向を確認します。

```js
geojson = turf.rewind(geojson, {
  reverse: true
});
```

を試します。

---

## 4. Geometryを簡略化して試す

複雑すぎるGeometryが原因か確認するため、

```js
const simple = turf.simplify(geojson, {
  tolerance: 0.001
});
```

として描画してみます。

簡略化版だけ正常に表示されるなら、頂点数やGeometryの複雑度が原因の可能性があります。

---

## 5. 1 Featureだけ描画する

大量のFeatureを一度に描画せず、

```js
const test = {
  type: "FeatureCollection",
  features: [
    geojson.features[0]
  ]
};
```

として切り分けます。

問題のあるFeatureを特定しやすくなります。

---

# 18. SVGではなくCanvasを検討すべきケース

Turf.jsでGeoJSONを簡略化しても、

- 数万Feature
- 数百万頂点
- リアルタイム更新
- 頻繁なアニメーション

がある場合、SVGよりCanvasの方が適しています。

D3の `geoPath()` はCanvas Contextへも描画できます。

```js
const canvas = document.querySelector("canvas");
const context = canvas.getContext("2d");

const path = d3.geoPath(projection, context);

context.beginPath();
path(geojson);
context.stroke();
```

つまり、

```text
GeoJSON
  ↓
Turf.js
  ↓
D3 Projection
  ↓
geoPath
  ├─ SVG
  └─ Canvas
```

という構成にできます。

データ量が大きい場合は、Turf.jsによる簡略化とCanvasレンダリングを組み合わせるのが有効です。

---

# 19. TopoJSONも検討する

大量の行政界データでは、隣接Polygonが同じ境界線を重複して保持します。

GeoJSON:

```text
Polygon A ──────
                │
                │
Polygon B ──────
```

AとBが共有する境界線を、それぞれ別々に座標列として保持します。

TopoJSONでは境界線を共有できるため、

- ファイルサイズ削減
- 重複座標削減
- 行政界などの表現に適する

というメリットがあります。

大量の自治体境界や国境データをD3で利用する場合は、

```text
GeoJSON
   ↓
TopoJSON
   ↓
D3
```

という構成も検討できます。

---

# 20. 推奨アーキテクチャ

実際のWeb GISアプリケーションでは、次のように入力とレンダリングを分離すると保守しやすくなります。

```text
API / GeoJSON / GISデータ
          │
          ▼
GeoJSON Validator
          │
          ▼
CRS / Coordinate Check
          │
          ▼
Turf.js Normalize Layer
          │
          ├─ cleanCoords
          ├─ rewind
          ├─ simplify
          ├─ flatten
          └─ geometry repair
          │
          ▼
Normalized GeoJSON
          │
          ▼
D3 Projection
          │
          ▼
d3.geoPath()
          │
          ├─ SVG
          └─ Canvas
```

D3の描画コードの中で毎回Geometryを修正するのではなく、

```text
GeoJSON入力
↓
正規化
↓
描画
```

という責務分離にしておくと、さまざまなGeoJSONを扱うアプリケーションでも安定します。

---

# 21. まとめ

D3.jsでGeoJSONを正常にレンダリングできない場合、D3そのものが原因とは限りません。

特に確認すべきなのは、

1. 座標順 `[longitude, latitude]`
2. 座標系
3. Polygonのリング方向
4. 重複座標
5. 自己交差
6. MultiPolygon
7. 頂点数
8. NaNやnull
9. 日付変更線
10. 二重投影

です。

Turf.jsでは、

```js
turf.cleanCoords()
turf.rewind()
turf.flip()
turf.toWgs84()
turf.simplify()
turf.flatten()
turf.unkinkPolygon()
turf.bbox()
```

などを利用することで、D3へ渡す前のGeoJSONをかなり扱いやすくできます。

特に実用上は、

```text
入力GeoJSON
↓
検証
↓
Turf.jsで正規化
↓
D3で投影
↓
SVG / Canvasで描画
```

という構成にするのがおすすめです。

---

# 参考

- D3 Geo  
  https://d3js.org/d3-geo

- D3 Geographic Projections  
  https://d3js.org/d3-geo/projection

- D3 Geographic Paths  
  https://d3js.org/d3-geo/path

- Turf.js  
  https://turfjs.org/

- Turf rewind  
  https://turfjs.org/docs/api/rewind

- Turf cleanCoords  
  https://turfjs.org/docs/api/cleanCoords

- Turf simplify  
  https://turfjs.org/docs/api/simplify

- Turf flatten  
  https://turfjs.org/docs/api/flatten

- Turf flip  
  https://turfjs.org/docs/api/flip

- Turf unkinkPolygon  
  https://turfjs.org/docs/api/unkinkPolygon

- RFC 7946 - The GeoJSON Format  
  https://datatracker.ietf.org/doc/html/rfc7946
