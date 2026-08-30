# D3.jsで美しいデータビジュアライゼーションを作るための実践ガイド

> D3.js の公式ドキュメント、Observable の D3 Examples、Datawrapper / Flourish のデータビジュアライゼーション設計ガイド、W3C WAI のアクセシビリティ資料などを横断し、D3.jsで「見やすく、美しく、意味の伝わる」チャートを作るための実践ノウハウを整理したものです。
>
> 調査日: 2026-08-30

---

## 目次

1. [最初に覚えるべき12原則](#1-最初に覚えるべき12原則)
2. [D3.jsで美しいチャートを作る基本思想](#2-d3jsで美しいチャートを作る基本思想)
3. [チャートを描く前に決めること](#3-チャートを描く前に決めること)
4. [レイアウトと余白](#4-レイアウトと余白)
5. [タイポグラフィ](#5-タイポグラフィ)
6. [軸・目盛り・グリッド線](#6-軸目盛りグリッド線)
7. [色の設計](#7-色の設計)
8. [ラベル・凡例・注釈](#8-ラベル凡例注釈)
9. [折れ線グラフ](#9-折れ線グラフ)
10. [棒グラフ](#10-棒グラフ)
11. [散布図](#11-散布図)
12. [ツールチップとインタラクション](#12-ツールチップとインタラクション)
13. [アニメーション](#13-アニメーション)
14. [レスポンシブ対応](#14-レスポンシブ対応)
15. [アクセシビリティ](#15-アクセシビリティ)
16. [SVGとCanvasの使い分け](#16-svgとcanvasの使い分け)
17. [D3コードを保守しやすくする設計](#17-d3コードを保守しやすくする設計)
18. [実務向けデザイントークン](#18-実務向けデザイントークン)
19. [再利用可能な折れ線グラフ実装例](#19-再利用可能な折れ線グラフ実装例)
20. [よくある「D3っぽいけれど美しくない」パターン](#20-よくあるd3っぽいけれど美しくないパターン)
21. [完成前チェックリスト](#21-完成前チェックリスト)
22. [参考資料](#22-参考資料)

---

# 1. 最初に覚えるべき12原則

D3.jsで美しいチャートを作るうえで、特に効果が大きい原則を先にまとめる。

### 1. データより目立つ装飾を作らない

チャートの主役はデータである。

軸、グリッド、背景、枠線などの非データ要素は、データより弱くする。

```css
.chart-grid line {
  stroke: #e5e7eb;
}

.chart-axis text {
  fill: #6b7280;
}

.chart-data-line {
  stroke-width: 2.2;
}
```

Datawrapper の設計ガイドでも、非データ要素には多段階のグレーを使い、データとの視覚的階層を作る考え方が強調されている。

---

### 2. 色を「装飾」ではなく「意味」に使う

色には役割を与える。

悪い例:

- 棒が10本あるので10色使う
- とりあえず `schemeCategory10`
- 全系列を高彩度にする

良い例:

- 基準系列 = グレー
- 注目系列 = アクセントカラー
- 正負 = diverging scale
- 強度 = sequential scale
- 種類 = categorical scale

---

### 3. 重要なものだけ強調する

優れたチャートでは、

> 「どこを見ればよいか」

が一瞬で分かる。

```js
const focus = "Japan";

selection
  .attr("stroke", d => d.country === focus ? "#2563eb" : "#cbd5e1")
  .attr("stroke-width", d => d.country === focus ? 3 : 1.2)
  .attr("opacity", d => d.country === focus ? 1 : 0.65);
```

「全部を目立たせる」は「何も目立たない」とほぼ同じである。

---

### 4. 凡例より直接ラベルを優先する

折れ線グラフでは、

```text
色を見る
↓
凡例を見る
↓
系列名を確認する
↓
線へ視線を戻す
```

という視線移動が発生する。

可能なら線の終端へ直接ラベルを置く。

```js
svg.selectAll(".series-label")
  .data(series)
  .join("text")
  .attr("x", d => x(d.values.at(-1).date) + 8)
  .attr("y", d => y(d.values.at(-1).value))
  .text(d => d.name);
```

Flourish も、複数系列では凡例より直接ラベルが理解しやすいケースが多いと説明している。

---

### 5. グリッド線は薄くする

Observable の D3 line chart examples でも、軸の domain line を消し、tick line を複製して薄いグリッドとして使うパターンが頻繁に使われている。

```js
yAxisG
  .call(d3.axisLeft(y))
  .call(g => g.select(".domain").remove())
  .call(g =>
    g.selectAll(".tick line")
      .clone()
      .attr("x2", innerWidth)
      .attr("stroke-opacity", 0.1)
  );
```

---

### 6. 余白を恐れない

チャート内の空白は無駄ではない。

余白には、

- タイトルとデータを分離する
- ラベルの衝突を防ぐ
- 視線を整理する
- 強調対象を浮かび上がらせる

役割がある。

---

### 7. 数値を読みやすく整形する

```js
const format = d3.format(".3~s");
```

例:

```text
1200       → 1.2k
1250000    → 1.25M
0.237      → 23.7%
```

数値フォーマットは見た目だけでなく認知負荷に影響する。

---

### 8. 曲線は「美しいから」という理由だけで使わない

```js
d3.curveBasis
d3.curveCatmullRom
d3.curveMonotoneX
```

などは見栄えが良いが、補間された形状が実データに存在するように見えることがある。

時系列では通常、

```js
d3.curveLinear
```

または、意味が妥当な場合に

```js
d3.curveMonotoneX
```

を使う方が安全である。

---

### 9. ツールチップだけに情報を隠さない

hover しなければ分からないグラフは、

- モバイル
- キーボード操作
- 印刷
- スクリーンリーダー

で問題になる。

主要メッセージは常時表示し、tooltip は詳細情報の補助に使う。

---

### 10. アニメーションには目的を持たせる

アニメーションの目的は、

- 更新前後の対応関係を維持する
- 並び替えを追いやすくする
- 状態変化を説明する

ことである。

単なる登場演出なら、短く控えめにする。

---

### 11. SVGをレスポンシブにする

Observable の chart template でも使われる基本形:

```js
svg
  .attr("viewBox", [0, 0, width, height])
  .attr("width", width)
  .attr("height", height)
  .attr("style", "max-width: 100%; height: auto;");
```

固定ピクセルだけでレイアウトしない。

---

### 12. 「何を伝えるグラフか」をタイトルに書く

悪いタイトル:

> 年別売上

良いタイトル:

> 売上は2024年以降、再び増加に転じた

チャートタイトルを単なるデータ項目名ではなく、読み手へのガイドとして使う。

---

# 2. D3.jsで美しいチャートを作る基本思想

D3.jsは「チャートライブラリ」というより、

> **データを視覚表現へ変換するための低レベルな部品群**

として考えた方がよい。

D3 の `scale` は、

```text
データ
↓
位置
色
サイズ
太さ
```

へ変換する。

たとえば、

```js
const x = d3.scaleUtc()
  .domain(d3.extent(data, d => d.date))
  .range([marginLeft, width - marginRight]);

const y = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.value)])
  .nice()
  .range([height - marginBottom, marginTop]);
```

というコードは単なる座標計算ではなく、

```text
日付 → x位置
値   → y位置
```

という**視覚エンコーディング**を定義している。

D3公式ドキュメントでも、scale は位置だけでなく色、線幅、記号サイズなど様々な視覚属性にデータを対応付けるものと説明されている。

---

# 3. チャートを描く前に決めること

コードを書く前に、最低でも以下を決める。

## 3.1 一番伝えたいこと

例:

```text
売上は伸びている
東京だけ突出している
2024年以降に傾向が変わった
気温と売上には相関がある
```

---

## 3.2 読み手に何を比較してほしいか

| 目的 | 向いている表現 |
|---|---|
| 時系列変化 | line chart |
| カテゴリ比較 | bar chart |
| 順位 | sorted bar chart |
| 2変数の関係 | scatterplot |
| 分布 | histogram / density |
| 構成比 | stacked bar |
| 空間分布 | map |
| 大量系列比較 | small multiples |

Flourish の storytelling framework でも、まず「伝える内容」を決め、それから chart type、data、color、text を設計する流れが推奨されている。

---

## 3.3 デザインより「読み取りタスク」を優先する

チャート選択は、

> 何が格好いいか

ではなく、

> 読み手はどの値を比較するのか

で決める。

たとえば大小比較なら、一般に角度や面積より「同じ基準線から伸びる長さ」の方が読み取りやすい。

したがって、円グラフより棒グラフが適するケースは非常に多い。

---

# 4. レイアウトと余白

## 4.1 Margin Convention

D3で最も基本的なレイアウトパターン。

```js
const margin = {
  top: 24,
  right: 32,
  bottom: 40,
  left: 56
};

const innerWidth =
  width - margin.left - margin.right;

const innerHeight =
  height - margin.top - margin.bottom;
```

Observable には Mike Bostock による Margin Convention の例があり、D3チャートの基本パターンとして広く使われている。

---

## 4.2 余白を固定値だけで考えない

ラベルが長い場合、

```js
margin.left = 40;
```

では足りない。

実務では、

- 文字数
- フォントサイズ
- 軸ラベル
- 直接ラベル
- モバイル幅

によって margin を変える。

---

## 4.3 右側の余白をラベル領域として使う

折れ線グラフでは右側を広く取ると美しくなる。

```js
const margin = {
  top: 32,
  right: 100,
  bottom: 36,
  left: 52
};
```

右側に系列名を直接配置するためである。

---

## 4.4 チャート周囲も設計する

良いデータビジュアライゼーションは SVG だけでは完成しない。

```html
<figure class="chart">
  <header>
    <h2>売上は2024年以降、再び増加</h2>
    <p>月次売上高、2020–2026年</p>
  </header>

  <svg></svg>

  <figcaption>
    出典: ○○統計
  </figcaption>
</figure>
```

タイトル、説明、出典を含めて一つの情報設計と考える。

---

# 5. タイポグラフィ

データビジュアライゼーションでは文字もグラフィックの一部である。

## 5.1 フォントは1〜2種類で十分

UI / Web向けでは、

```css
font-family:
  Inter,
  "Noto Sans JP",
  system-ui,
  sans-serif;
```

のような構成が扱いやすい。

---

## 5.2 文字サイズに階層を作る

例:

```css
.chart-title {
  font-size: 22px;
  font-weight: 650;
}

.chart-subtitle {
  font-size: 14px;
  color: #6b7280;
}

.chart-axis {
  font-size: 11px;
}

.chart-label {
  font-size: 12px;
  font-weight: 600;
}

.chart-source {
  font-size: 10px;
  color: #9ca3af;
}
```

---

## 5.3 軸ラベルを小さくしすぎない

チャートを「洗練された見た目」にしようとして、

```css
font-size: 8px;
```

のようにするのは避ける。

美しさより可読性が優先される。

---

## 5.4 単位を毎tickに繰り返さない

悪い例:

```text
10 km
20 km
30 km
40 km
```

場合によっては、

```text
距離 (km)

10
20
30
40
```

の方がすっきりする。

ただし `%`、通貨など、値単独では意味が曖昧な場合は tick に付けてもよい。

---

# 6. 軸・目盛り・グリッド線

D3では `d3-axis` が scale から軸を生成する。

```js
const xAxis = d3.axisBottom(x);
const yAxis = d3.axisLeft(y);
```

デフォルトの軸をそのまま使うより、チャートに合わせて「引き算」すると見栄えがよくなる。

---

## 6.1 outer tickを消す

```js
const xAxis = d3.axisBottom(x)
  .ticks(width / 80)
  .tickSizeOuter(0);
```

---

## 6.2 y軸のdomain lineを消す

```js
yAxisG
  .call(d3.axisLeft(y))
  .call(g => g.select(".domain").remove());
```

軸の太い縦線を消すだけでモダンな印象になりやすい。

---

## 6.3 grid line は薄く

```js
yAxisG
  .selectAll(".tick line")
  .clone()
  .attr("x2", innerWidth)
  .attr("stroke", "#e5e7eb")
  .attr("stroke-opacity", 0.8);
```

または独立した grid layer を作る。

```js
svg.append("g")
  .attr("class", "grid")
  .attr("transform", `translate(${margin.left},0)`)
  .call(
    d3.axisLeft(y)
      .tickSize(-innerWidth)
      .tickFormat("")
  )
  .call(g => g.select(".domain").remove());
```

---

## 6.4 tick数を画面サイズに合わせる

Observable のサンプルでは、

```js
.ticks(width / 80)
```

や、

```js
.ticks(height / 40)
```

のように、チャートサイズから tick 数を決める例がある。

これはレスポンシブチャートで有効。

---

## 6.5 `nice()` を使う

```js
const y = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.value)])
  .nice()
  .range([height - margin.bottom, margin.top]);
```

最大値が

```text
97
```

の場合でも、

```text
100
```

など人間が読みやすい境界へ調整される。

---

## 6.6 0 baselineを強調する

正負を扱う場合:

```js
svg.append("line")
  .attr("x1", margin.left)
  .attr("x2", width - margin.right)
  .attr("y1", y(0))
  .attr("y2", y(0))
  .attr("stroke", "#9ca3af")
  .attr("stroke-width", 1);
```

通常の grid より少し濃くする。

---

# 7. 色の設計

色はD3チャートの完成度を大きく左右する。

D3には `d3-scale-chromatic` があり、

- categorical
- sequential
- diverging
- cyclical

などのパレットが用意されている。

ColorBrewer由来の多くのスキームも利用できる。

---

## 7.1 カテゴリデータ

```js
const color = d3.scaleOrdinal()
  .domain(categories)
  .range(d3.schemeTableau10);
```

または、

```js
d3.schemeObservable10
```

など。

ただし、

> パレットに10色あるから10色使う

という意味ではない。

必要な色だけ使う。

---

## 7.2 連続量

```js
const color = d3.scaleSequential()
  .domain([0, 100])
  .interpolator(d3.interpolateBlues);
```

例:

```text
人口密度
降水量
標高
濃度
頻度
```

---

## 7.3 正負・平均との差

```js
const color = d3.scaleDiverging()
  .domain([-5, 0, 5])
  .interpolator(d3.interpolateRdBu);
```

例:

```text
気温偏差
前年比
平均との差
残差
```

0や基準値を中心にする。

---

## 7.4 グレーを積極的に使う

Datawrapper のカラーガイドで特に参考になる考え方。

```text
重要データ     → アクセントカラー
比較対象       → 中間色
非注目データ   → グレー
軸             → グレー
grid           → 明るいグレー
注記           → 暗いグレー
```

グレーは「色がない」のではなく、重要度を制御するための色である。

---

## 7.5 彩度100%の色を多用しない

```css
#ff0000
#00ff00
#0000ff
```

のような純色は強すぎることが多い。

少し抑えた色の方が、長時間見ても疲れにくい。

---

## 7.6 大きな面積ほど彩度を下げる

同じ色でも、

- 1pxの線
- 6pxの点
- 大きな面積

では感じる強さが違う。

面グラフや塗りつぶしポリゴンでは、線より彩度・opacityを下げる。

```js
area
  .attr("fill", "#3b82f6")
  .attr("fill-opacity", 0.16);

line
  .attr("stroke", "#2563eb")
  .attr("stroke-width", 2);
```

---

## 7.7 色だけで区別しない

色覚多様性への対応だけでなく、白黒印刷や低品質ディスプレイにも強くなる。

```js
const dash = {
  observed: null,
  forecast: "5 4"
};
```

```js
.attr("stroke-dasharray", d => dash[d.type])
```

色 + dash + label のように複数の手掛かりを持たせる。

---

# 8. ラベル・凡例・注釈

## 8.1 直接ラベル

特に折れ線では強力。

```js
const last = d.values.at(-1);

label
  .attr("x", x(last.date) + 8)
  .attr("y", y(last.value))
  .text(d.name);
```

---

## 8.2 棒グラフは値を直接表示できる

```js
svg.selectAll(".value")
  .data(data)
  .join("text")
  .attr("x", d => x(d.value) + 6)
  .attr("y", d => y(d.name) + y.bandwidth() / 2)
  .attr("dominant-baseline", "middle")
  .text(d => d3.format(",")(d.value));
```

すると x-axis 自体を弱くできる場合もある。

---

## 8.3 注釈で「意味」を説明する

単に値を表示するだけでなく、

```text
↑ 2024年から急増
```

のように読み取りをガイドする。

```js
svg.append("text")
  .attr("x", x(new Date("2024-01-01")))
  .attr("y", y(82) - 20)
  .text("2024年から増加が加速");
```

---

## 8.4 参照線

平均値:

```js
const mean = d3.mean(data, d => d.value);

svg.append("line")
  .attr("x1", margin.left)
  .attr("x2", width - margin.right)
  .attr("y1", y(mean))
  .attr("y2", y(mean))
  .attr("stroke", "#9ca3af")
  .attr("stroke-dasharray", "4 4");
```

---

## 8.5 凡例が必要なら情報構造を作る

10色を横に並べるだけではなく、

- ソートする
- 関連カテゴリをまとめる
- カテゴリ名を短くする
- 形や線種も示す

などを行う。

Datawrapper は、color key も「読者が色の意味を素早く理解するためのUI」として設計することを推奨している。

---

# 9. 折れ線グラフ

## 9.1 基本

```js
const line = d3.line()
  .x(d => x(d.date))
  .y(d => y(d.value));
```

```js
svg.append("path")
  .datum(data)
  .attr("fill", "none")
  .attr("stroke", "#2563eb")
  .attr("stroke-width", 2.2)
  .attr("stroke-linecap", "round")
  .attr("stroke-linejoin", "round")
  .attr("d", line);
```

`stroke-linecap` と `stroke-linejoin` を round にするだけでも印象が柔らかくなる。

---

## 9.2 欠損値を正しく扱う

Observable の missing data example で使われるパターン:

```js
const line = d3.line()
  .defined(d => Number.isFinite(d.value))
  .x(d => x(d.date))
  .y(d => y(d.value));
```

欠損区間を勝手につないではいけない。

---

## 9.3 系列が多いときは全部同じ強さにしない

```js
const selected = "Brazil";

paths
  .attr("stroke", d =>
    d.name === selected
      ? "#2563eb"
      : "#d1d5db"
  )
  .attr("stroke-width", d =>
    d.name === selected ? 3 : 1
  );
```

---

## 9.4 予測値は線種を変える

```js
.attr("stroke-dasharray", d =>
  d.type === "forecast" ? "6 4" : null
)
```

実測と予測を色だけで区別しない。

---

# 10. 棒グラフ

カテゴリ位置には `scaleBand` が標準。

```js
const y = d3.scaleBand()
  .domain(data.map(d => d.name))
  .range([margin.top, height - margin.bottom])
  .padding(0.24);
```

---

## 10.1 ランキングは横棒が強い

長いカテゴリ名を読みやすい。

```js
const x = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.value)])
  .nice()
  .range([margin.left, width - margin.right]);
```

---

## 10.2 値でソートする

```js
data.sort((a, b) =>
  d3.descending(a.value, b.value)
);
```

ランキングでは特に重要。

---

## 10.3 すべて違う色にしない

悪い例:

```js
.attr("fill", (d, i) => d3.schemeCategory10[i])
```

良い例:

```js
.attr("fill", d =>
  d.name === "Japan"
    ? "#2563eb"
    : "#d1d5db"
)
```

---

## 10.4 baselineを切るときは慎重に

棒グラフは「長さ」が値を表す。

原則として0 baselineを維持する。

折れ線とは扱いが異なる。

---

# 11. 散布図

## 11.1 点の重なりを意識する

```js
.attr("r", 3.5)
.attr("fill-opacity", 0.45)
```

大量の点では opacity が有効。

---

## 11.2 strokeを付ける

背景や重なりに強くなる。

```js
.attr("fill", "#3b82f6")
.attr("fill-opacity", 0.5)
.attr("stroke", "#1d4ed8")
.attr("stroke-width", 0.6);
```

---

## 11.3 注目点だけラベル

全部にラベルを付けると読めない。

```js
const important =
  data.filter(d => d.isImportant);
```

---

## 11.4 トレンドラインを重ねる

散布図では個々の点と全体傾向を分ける。

```text
points → 個別観測
line   → 全体傾向
```

---

# 12. ツールチップとインタラクション

Observable の D3 examples には pointer event を使った tooltip 実装例がある。

マウスだけでなく pointer event を使うと、

- mouse
- pen
- touch

を扱いやすい。

```js
svg
  .on("pointerenter", pointerMoved)
  .on("pointermove", pointerMoved)
  .on("pointerleave", pointerLeft);
```

---

## 12.1 折れ線では最近傍点を探す

```js
const bisect = d3.bisector(d => d.date).center;

function pointerMoved(event) {
  const [mx] = d3.pointer(event);
  const date = x.invert(mx);
  const i = bisect(data, date);

  const d = data[i];

  focus
    .attr("transform",
      `translate(${x(d.date)},${y(d.value)})`
    );
}
```

---

## 12.2 hover対象を大きくする

線幅が2pxしかない場合、その線そのものに hover を要求すると操作しにくい。

透明な太い hit-area を重ねる。

```js
svg.append("path")
  .datum(data)
  .attr("d", line)
  .attr("fill", "none")
  .attr("stroke", "transparent")
  .attr("stroke-width", 16)
  .style("pointer-events", "stroke");
```

---

## 12.3 tooltipはマウスカーソルに近づけすぎない

```js
tooltip
  .style("left", `${event.clientX + 12}px`)
  .style("top", `${event.clientY + 12}px`);
```

カーソルそのものを隠さない。

---

## 12.4 hoverで他系列を薄くする

```js
series
  .on("pointerenter", (_, active) => {
    series.attr("opacity", d =>
      d === active ? 1 : 0.12
    );
  })
  .on("pointerleave", () => {
    series.attr("opacity", 1);
  });
```

非常に効果的だが、hoverしなければ理解できない設計にはしない。

---

# 13. アニメーション

D3の `d3-transition` はDOMの属性・styleなどを補間して状態間を滑らかに変化させる。

```js
selection
  .transition()
  .duration(500)
  .attr("x", ...)
  .attr("width", ...);
```

---

## 13.1 500ms前後から試す

用途によるが、UI的な状態変化なら長すぎない方がよい。

```js
.duration(450)
```

---

## 13.2 並び替えでは stagger を使える

D3公式の transition timing documentation でも、要素ごとの delay により並び替えなどの知覚を助けられることが説明されている。

```js
.delay((d, i) => i * 20)
```

ただし100項目に対して使うと遅すぎる。

---

## 13.3 enter animationよりupdate animationを重視する

重要なのは、

```text
前の状態
↓
新しい状態
```

の対応関係が分かること。

単なる「棒が下から伸びる」演出より価値が高い。

---

## 13.4 prefers-reduced-motion

```js
const reduceMotion =
  window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

const duration = reduceMotion ? 0 : 450;
```

---

## 13.5 過剰なアニメーションを避ける

避けたいもの:

```text
全棒がバウンド
全点がランダム位置から飛来
常時パルス
長いelastic easing
```

チャートを読むよりアニメーションを見る状態を作らない。

---

# 14. レスポンシブ対応

Observable の D3 chart template は、

```js
.attr("viewBox", [0, 0, width, height])
.attr("style", "max-width: 100%; height: auto;");
```

というシンプルな方式を採用している。

---

## 14.1 SVGの基本

```js
const svg = d3.create("svg")
  .attr("width", width)
  .attr("height", height)
  .attr("viewBox", [0, 0, width, height])
  .style("max-width", "100%")
  .style("height", "auto");
```

---

## 14.2 ResizeObserver

より高度な対応ではコンテナ幅を監視する。

```js
const observer =
  new ResizeObserver(entries => {
    const width =
      entries[0].contentRect.width;

    render(width);
  });

observer.observe(container);
```

---

## 14.3 モバイルでは情報量も変える

単純縮小だけでは不十分。

例:

```js
const mobile = width < 520;

const tickCount =
  mobile ? 4 : 8;

const marginRight =
  mobile ? 20 : 100;
```

モバイルでは、

- tickを減らす
- annotationを減らす
- 直接ラベルを整理する
- 凡例の位置を変える
- small multiples の列数を変える

などを行う。

---

# 15. アクセシビリティ

W3C WAI は、チャートやグラフを「complex images」として扱い、短い説明だけでなく、必要に応じて詳細なテキスト説明やデータ表など、視覚情報と同等の情報を提供することを推奨している。

---

## 15.1 SVGへaccessible nameを付ける

```html
<svg
  role="img"
  aria-labelledby="chart-title chart-desc"
>
  <title id="chart-title">
    2020年から2026年の売上推移
  </title>

  <desc id="chart-desc">
    売上は2023年まで横ばいだったが、
    2024年以降は増加している。
  </desc>
</svg>
```

W3C は SVG の `<title>` / `<desc>` の支援技術対応にばらつきがあることも指摘しており、`role="img"` や ARIA と組み合わせる方法が実務上重要になる。

---

## 15.2 長い説明をHTML側にも置く

```html
<figure>
  <svg ...></svg>

  <figcaption>
    2020〜2023年はほぼ横ばい。
    2024年から増加し、2026年には
    2023年比で約30%増加した。
  </figcaption>
</figure>
```

---

## 15.3 元データの表を提供する

```html
<details>
  <summary>データを表で表示</summary>

  <table>
    ...
  </table>
</details>
```

グラフしか情報源がない状態を避ける。

---

## 15.4 色だけに依存しない

W3C のアクセシビリティ資料でも、チャートやグラフでは色だけで情報を伝えないことが重要とされる。

組み合わせ:

```text
色
線種
形
直接ラベル
位置
テキスト
```

---

## 15.5 interactive chartはキーボードでも操作可能にする

SVGの点を操作対象にするなら、

```js
.attr("tabindex", 0)
.attr("role", "button")
```

などを検討する。

ただし、1万点すべてをtab対象にするのは逆に使いにくい。

インタラクション設計自体を見直す。

---

# 16. SVGとCanvasの使い分け

D3はSVG専用ではない。

`d3-shape` の generator は Canvas 2D context にも描画できる。

---

## SVGが向いている

```text
数十〜数千要素
軸
ラベル
注釈
インタラクション
DOM/CSSで個別制御したい
```

---

## Canvasが向いている

```text
数万〜数十万点
大量particle
高密度scatter
高頻度更新
```

---

## Hybridが強い

実務では、

```text
Canvas:
  データ点
  大量ライン

SVG:
  axis
  labels
  annotations
  interaction overlay
```

という組み合わせが使いやすい。

---

# 17. D3コードを保守しやすくする設計

美しいチャートを継続的に作るには、コード設計も重要。

---

## 17.1 データ変換と描画を分ける

悪い例:

```js
svg.selectAll("rect")
  .data(
    raw
      .filter(...)
      .map(...)
      .sort(...)
  )
```

良い例:

```js
const data =
  prepareData(raw);

renderChart(data);
```

---

## 17.2 scaleを一か所にまとめる

```js
function createScales(
  data,
  width,
  height,
  margin
) {
  return {
    x: d3.scaleUtc(...),
    y: d3.scaleLinear(...)
  };
}
```

---

## 17.3 layerを分ける

```js
const gridLayer =
  svg.append("g")
    .attr("class", "grid");

const dataLayer =
  svg.append("g")
    .attr("class", "data");

const annotationLayer =
  svg.append("g")
    .attr("class", "annotations");

const interactionLayer =
  svg.append("g")
    .attr("class", "interaction");
```

描画順も明確になる。

---

## 17.4 `.join()` を基本にする

D3公式では `selection.join()` によって enter / update / exit を簡潔に扱える。

```js
svg.selectAll("circle")
  .data(data, d => d.id)
  .join(
    enter =>
      enter
        .append("circle")
        .attr("r", 0)
        .call(enter =>
          enter.transition()
            .attr("r", 4)
        ),

    update =>
      update,

    exit =>
      exit
        .transition()
        .attr("r", 0)
        .remove()
  );
```

keyを使うと「同じデータ項目」をDOM上でも追跡しやすくなる。

---

# 18. 実務向けデザイントークン

D3コード内に色やサイズを散らばらせない。

```js
const theme = {
  colors: {
    text: "#111827",
    mutedText: "#6b7280",

    axis: "#9ca3af",
    grid: "#e5e7eb",

    primary: "#2563eb",
    secondary: "#7c3aed",

    muted: "#cbd5e1",

    positive: "#15803d",
    negative: "#b91c1c",

    background: "#ffffff"
  },

  font: {
    family:
      'Inter, "Noto Sans JP", system-ui, sans-serif',

    title: 22,
    subtitle: 14,
    axis: 11,
    label: 12,
    note: 10
  },

  line: {
    normal: 1.5,
    focus: 2.75
  },

  radius: {
    point: 3.5,
    focus: 5
  },

  motion: {
    duration: 450
  }
};
```

これによりチャート間の統一感が生まれる。

Datawrapper の custom themes でも、色だけでなく typography、gridlines、background、labels などを一貫したテーマとして定義する考え方が採られている。

---

# 19. 再利用可能な折れ線グラフ実装例

以下は、本ガイドの考え方をまとめたベース実装。

```js
function lineChart(data, {
  width = 900,
  height = 460,

  xValue = d => d.date,
  yValue = d => d.value,

  color = "#2563eb",

  yLabel = "",
  title = "",
  description = ""
} = {}) {

  const margin = {
    top: 28,
    right: 36,
    bottom: 38,
    left: 58
  };

  const innerWidth =
    width - margin.left - margin.right;

  // -----------------------------
  // Scale
  // -----------------------------

  const x = d3.scaleUtc()
    .domain(d3.extent(data, xValue))
    .range([
      margin.left,
      width - margin.right
    ]);

  const y = d3.scaleLinear()
    .domain([
      0,
      d3.max(data, yValue)
    ])
    .nice()
    .range([
      height - margin.bottom,
      margin.top
    ]);

  // -----------------------------
  // Generator
  // -----------------------------

  const line = d3.line()
    .defined(
      d => Number.isFinite(yValue(d))
    )
    .x(d => x(xValue(d)))
    .y(d => y(yValue(d)));

  // -----------------------------
  // SVG
  // -----------------------------

  const svg = d3.create("svg")
    .attr("width", width)
    .attr("height", height)
    .attr(
      "viewBox",
      [0, 0, width, height]
    )
    .attr(
      "style",
      `
        max-width:100%;
        height:auto;
        font:
          11px Inter,
          "Noto Sans JP",
          system-ui,
          sans-serif;
      `
    )
    .attr("role", "img")
    .attr(
      "aria-labelledby",
      "chart-title chart-desc"
    );

  svg.append("title")
    .attr("id", "chart-title")
    .text(title);

  svg.append("desc")
    .attr("id", "chart-desc")
    .text(description);

  // -----------------------------
  // Grid + Y axis
  // -----------------------------

  const yAxis =
    svg.append("g")
      .attr(
        "transform",
        `translate(${margin.left},0)`
      )
      .call(
        d3.axisLeft(y)
          .ticks(height / 50)
      );

  // 軸の縦線を消す
  yAxis
    .select(".domain")
    .remove();

  // tick線を横方向へ伸ばしてgrid化
  yAxis
    .selectAll(".tick line")
    .clone()
    .attr(
      "x2",
      innerWidth
    )
    .attr(
      "stroke",
      "#e5e7eb"
    )
    .attr(
      "stroke-opacity",
      0.8
    );

  yAxis
    .selectAll(".tick text")
    .attr(
      "fill",
      "#6b7280"
    );

  // 単位
  if (yLabel) {
    yAxis.append("text")
      .attr(
        "x",
        -margin.left
      )
      .attr(
        "y",
        10
      )
      .attr(
        "fill",
        "#6b7280"
      )
      .attr(
        "text-anchor",
        "start"
      )
      .text(yLabel);
  }

  // -----------------------------
  // X axis
  // -----------------------------

  const xAxis =
    svg.append("g")
      .attr(
        "transform",
        `translate(
          0,
          ${height - margin.bottom}
        )`
      )
      .call(
        d3.axisBottom(x)
          .ticks(width / 90)
          .tickSizeOuter(0)
      );

  xAxis
    .select(".domain")
    .attr(
      "stroke",
      "#d1d5db"
    );

  xAxis
    .selectAll(".tick text")
    .attr(
      "fill",
      "#6b7280"
    );

  xAxis
    .selectAll(".tick line")
    .attr(
      "stroke",
      "#d1d5db"
    );

  // -----------------------------
  // Data line
  // -----------------------------

  svg.append("path")
    .datum(data)
    .attr("fill", "none")
    .attr(
      "stroke",
      color
    )
    .attr(
      "stroke-width",
      2.25
    )
    .attr(
      "stroke-linecap",
      "round"
    )
    .attr(
      "stroke-linejoin",
      "round"
    )
    .attr(
      "d",
      line
    );

  // -----------------------------
  // Hover
  // -----------------------------

  const focus =
    svg.append("g")
      .style(
        "display",
        "none"
      );

  focus.append("circle")
    .attr("r", 4.5)
    .attr("fill", "#fff")
    .attr(
      "stroke",
      color
    )
    .attr(
      "stroke-width",
      2
    );

  const valueText =
    focus.append("text")
      .attr("x", 9)
      .attr("y", -9)
      .attr(
        "font-weight",
        600
      )
      .attr(
        "fill",
        "#111827"
      );

  const bisect =
    d3.bisector(xValue).center;

  svg
    .style(
      "-webkit-tap-highlight-color",
      "transparent"
    )
    .on(
      "pointerenter pointermove",
      pointerMoved
    )
    .on(
      "pointerleave",
      () =>
        focus.style(
          "display",
          "none"
        )
    );

  function pointerMoved(event) {

    const [mx] =
      d3.pointer(event);

    const date =
      x.invert(mx);

    const index =
      bisect(data, date);

    const d =
      data[index];

    if (!d) return;

    focus
      .style(
        "display",
        null
      )
      .attr(
        "transform",
        `translate(
          ${x(xValue(d))},
          ${y(yValue(d))}
        )`
      );

    valueText.text(
      d3.format(",")(yValue(d))
    );
  }

  return svg.node();
}
```

---

# 20. よくある「D3っぽいけれど美しくない」パターン

## NG 1: デフォルト軸そのまま

```text
黒い軸
黒いtick
黒いgrid
濃いデータ線
```

すべて同じ強さになる。

### 改善

```text
data       100%
labels      70%
axis        40%
grid        15%
```

くらいの視覚的階層を意識する。

---

## NG 2: Category10を無条件に使う

```js
d3.schemeCategory10
```

自体が悪いわけではない。

問題は、

```text
10カテゴリ = 10色
```

と機械的に考えること。

---

## NG 3: 虹色の連続スケール

量的データに虹色を使うと、

- 色相境界が偽の境界に見える
- 明度が単調でない
- 値の大小を直感的に把握しにくい

ことがある。

多くの場合、

```js
d3.interpolateBlues
d3.interpolateViridis
d3.interpolateYlGnBu
```

などの sequential palette が扱いやすい。

---

## NG 4: 全点にラベル

散布図100点に100ラベル。

### 改善

```text
極値
外れ値
注目対象
hover対象
```

だけ表示。

---

## NG 5: gridがデータより濃い

視線が格子へ引かれる。

---

## NG 6: tooltipだけに値を書く

静止画、印刷、アクセシビリティに弱い。

---

## NG 7: 画面サイズに関係なくtick数固定

```js
.ticks(20)
```

モバイルで破綻する。

---

## NG 8: すべてtransition

更新するたびに、

```text
axis
grid
label
tooltip
title
data
```

全部が動くと落ち着かない。

意味のある変化だけ動かす。

---

## NG 9: splineでデータを美化する

見た目は滑らかだが、観測されていない極値を暗示することがある。

---

## NG 10: チャートのタイトルが変数名だけ

```text
人口
売上
温度
```

では読み手に何を見るべきか伝わらない。

---

# 21. 完成前チェックリスト

## Story

- [ ] このグラフで一番伝えたいことを1文で言える
- [ ] タイトルが「何を見るべきか」を示している
- [ ] 不要な系列を削除した
- [ ] 不要な装飾を削除した

---

## Chart Type

- [ ] 読み手が比較する対象に適したチャートか
- [ ] 棒グラフなら0 baselineを確認した
- [ ] 時系列ならline chartをまず検討した
- [ ] 多数系列ならsmall multiplesを検討した

---

## Layout

- [ ] ラベルが端で切れていない
- [ ] 十分な余白がある
- [ ] タイトル・本文・出典の階層がある
- [ ] モバイルでも確認した

---

## Axis

- [ ] tickが多すぎない
- [ ] 数値フォーマットが適切
- [ ] 単位が分かる
- [ ] gridが強すぎない
- [ ] 不要なdomain lineを消した

---

## Color

- [ ] 色に明確な役割がある
- [ ] 注目対象が最も目立つ
- [ ] 非注目対象をグレー化できないか検討した
- [ ] sequential / diverging / categorical を正しく使い分けた
- [ ] 色だけで意味を区別していない
- [ ] 高彩度色を使いすぎていない

---

## Labels

- [ ] 凡例を直接ラベルに置き換えられないか検討した
- [ ] 重要な値は常時見える
- [ ] annotation が読み取りを助けている
- [ ] ラベル同士が重なっていない

---

## Interaction

- [ ] hoverしないと意味が分からない設計になっていない
- [ ] pointer eventを検討した
- [ ] hover targetが十分大きい
- [ ] touchでも操作できる

---

## Motion

- [ ] アニメーションに意味がある
- [ ] 長すぎない
- [ ] prefers-reduced-motion を考慮した
- [ ] 常時アニメーションしていない

---

## Accessibility

- [ ] SVGにaccessible nameがある
- [ ] チャートの要点をテキストでも説明している
- [ ] 必要ならデータ表を提供している
- [ ] 色だけに依存していない
- [ ] interactive UIをキーボードでも扱える

---

## Performance

- [ ] DOM要素数が過剰でない
- [ ] 大量点ではCanvasを検討した
- [ ] 不要な再描画をしていない
- [ ] `.join()` とkeyを適切に使っている

---

# 22. 参考資料

以下は本ガイド作成時に参照した主要資料。

## D3公式

### D3 Scales
https://d3js.org/d3-scale

データから位置・色・サイズ等への変換を扱う中心モジュール。

### D3 Axis
https://d3js.org/d3-axis

tick、tick format、軸生成。

### D3 Shape
https://d3js.org/d3-shape

line、area、arc、pie、stack、curveなど。

### D3 Data Join
https://d3js.org/d3-selection/joining

`selection.data()`、`selection.join()`、enter/update/exit。

### D3 Transition
https://d3js.org/d3-transition

DOM属性やstyleの補間アニメーション。

### Transition Timing
https://d3js.org/d3-transition/timing

duration、delay、staggerなど。

### D3 Format
https://d3js.org/d3-format

数値フォーマット。

### D3 Time Format
https://d3js.org/d3-time-format

日時のparse / format。

### D3 Scale Chromatic
https://d3js.org/d3-scale-chromatic

categorical / sequential / diverging color scheme。

### Sequential Scales
https://d3js.org/d3-scale/sequential

連続量の色エンコーディング。

### Diverging Scales
https://d3js.org/d3-scale/diverging

正負・平均との差などの中心値を持つスケール。

---

## Observable / D3 Examples

### Chart Template
https://observablehq.com/@d3/chart-template

`viewBox`、margin、axisを含むモダンなD3チャートの基本形。

### Margin Convention
https://observablehq.com/@d3/margin-convention

D3の定番marginパターン。

### Line Chart
https://observablehq.com/@d3/line-chart

折れ線グラフの標準例。

### Multi-line Chart
https://observablehq.com/@d3/multi-line-chart

複数系列。

### Line Chart with Tooltip
https://observablehq.com/@d3/line-with-tooltip

pointer interactionを使ったtooltip。

### Missing Data
https://observablehq.com/@d3/line-chart-missing-data

`line.defined()` による欠損値処理。

### Color Legend
https://observablehq.com/@d3/color-legend

連続・カテゴリcolor scaleのlegend実装。

### D3 Documentation Collection
https://observablehq.com/collection/@d3/documentation

公式D3 examples / modulesへの入口。

---

## Datawrapper

### A detailed guide to colors in data vis style guides
https://www.datawrapper.de/blog/colors-for-data-vis-style-guides

チャートの色設計、グレー、カテゴリ色、背景、dark modeなど非常に実践的。

### How to pick more beautiful colors for your data visualizations
https://www.datawrapper.de/blog/beautifulcolors

高彩度色、明度、色相、背景とのコントラストなど。

### What to consider when choosing colors for data visualization
https://www.datawrapper.de/blog/colors

カテゴリ色、gradient、色数、文化的意味など。

### 10 ways to use fewer colors
https://www.datawrapper.de/blog/10-ways-to-use-fewer-colors-in-your-data-visualizations

色を減らし、形・線種・small multiplesなどを使う考え方。

### How to design a useful color key
https://www.datawrapper.de/blog/color-keys-for-data-visualizations

凡例を単なる色一覧ではなく情報UIとして設計する方法。

### Customizing your line chart
https://www.datawrapper.de/academy/customizing-your-line-chart

軸、grid、ラベル、線幅、補間、色などの実務的設定。

### Custom Themes
https://www.datawrapper.de/custom-themes

色、文字、grid、背景などを組織レベルで統一する考え方。

---

## Flourish

### Master data storytelling
https://flourish.studio/learn/master-data-storytelling/

Narrative、chart type、data、color、textの5要素。

### A guide to creating compelling visualizations
https://flourish.studio/blog/dataviz-best-practice/

ストーリー、チャートタイプ、数値、色、ラベルの基本。

### A beginner’s guide to using text in data visualization
https://flourish.studio/blog/text-in-data-visualization/

直接ラベル、タイトル、注釈などテキストの使い方。

### 5 pitfalls to avoid when working with color
https://flourish.studio/blog/color-in-data-visualization/

色数、高彩度、アクセシビリティなどの注意点。

---

## Accessibility / W3C

### WAI: Complex Images
https://www.w3.org/WAI/tutorials/images/complex/

チャート、グラフ、地図などに短い説明 + 詳細説明を提供する考え方。

### WAI: Images Tutorial
https://www.w3.org/WAI/tutorials/images/

非テキスト情報の代替テキスト。

### WAI: SVG tips
https://www.w3.org/WAI/tutorials/images/tips/

SVGのtitleとARIAの扱い。

### SVG element with explicit role has non-empty accessible name
https://www.w3.org/WAI/standards-guidelines/act/rules/7d6734

SVG accessibility、`role="img"`、accessible name。

---

## Animation research

### Heer, J. & Robertson, G. — Animated Transitions in Statistical Data Graphics

https://idl.cs.washington.edu/files/2007-AnimatedTransitions-InfoVis.pdf

統計グラフにおけるanimated transitionの知覚効果と設計原則を扱った研究。

---

# 最終的な考え方

D3.jsで美しいデータビジュアライゼーションを作る方法は、

```text
D3の高度なAPIをたくさん使う
```

ことではない。

むしろ、

```text
データ
 ↓
伝えたいメッセージ
 ↓
適切な視覚エンコーディング
 ↓
視覚的階層
 ↓
必要最小限の色
 ↓
読みやすい文字
 ↓
弱い軸とgrid
 ↓
直接ラベルと注釈
 ↓
必要なinteraction
 ↓
必要なanimation
```

という順番で考えることが重要である。

D3.jsの強みは、既製チャートの見た目に従う必要がなく、

> **「データの意味に合わせて、必要な視覚表現だけを組み立てられること」**

にある。

美しいD3チャートとは、装飾の多いチャートではなく、

> **重要な情報が最も自然に目へ入り、不要な要素が静かに後ろへ下がっているチャート**

と考えると設計しやすい。
