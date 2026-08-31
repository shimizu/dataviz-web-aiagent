// 一般チャート（折れ線・棒・散布図など）を美しく作るための指針スキル（Markdown 文字列・決定的）。
//
// 役割: 図の選び方・レイアウト・軸・ラベルの作法（reference/d3js_beautiful_dataviz_guide.md の要約）と、
//       **配色の規則**（検証済みの固定順パレット・注目以外は見えるグレー・量は単色ランプ）を Claude に教える。
//       配色は theme（viz/viz-theme.js）の値だけを使わせ、似た色や薄い色でまとめる失敗を防ぐ。揮発情報は含めない。
// 関係: tools/dataviz/index.js が skills に載せる。詳細節は read_reference('dataviz', 番号) で取得できる。
// 流用元: reference/d3js_beautiful_dataviz_guide.md §1・§3〜§11・§16〜§17・§20〜§21 + 検証済み配色パレット
export const DATAVIZ_CHARTS_SKILL = `# スキル: チャートの作法（折れ線・棒・散布図・分布）

## 守る規則（MUST）

1. **MUST: 棒は 0 から伸ばす**。基線を切らない（折れ線は切ってよい）。
2. **MUST: 2 軸（左右で別スケール）を作らない** — 尺度の違う 2 指標は 2 枚に分けるか、共通の基準（指数化）に揃える。
3. **MUST: 無順序のカテゴリを線でつながない** — 「都市別」を折れ線にすると存在しないトレンドに見える → 棒。
4. **MUST: 円グラフは 5 区分まで・0 や負の値には使わない** — 超えたら降順の横棒。
5. **MUST: 円の半径は \`d3.scaleSqrt\`** — 面積を値に比例させる（linear だと大が誇張される）。
6. **MUST: 凡例は描画と同じスケールから作る** — 凡例用に別の色配列・別の閾値を書かない。

## 1. 図の選び方は「読み手が何を比較するか」で決める

| 伝えたいこと | 第一候補 | 補足 |
|---|---|---|
| 時系列の変化 | 折れ線 | 系列が多ければ注目系列以外を文脈色に、または small multiples |
| カテゴリ間の大小 | 棒（縦） | 0 を基準線にする。角度・面積より「同じ基準線からの長さ」が読みやすい |
| 順位 | 横棒を値でソート | 長いカテゴリ名も読める |
| 2 変数の関係 | 散布図 | 傾向線を重ねると「個別」と「全体」が分かれる |
| 分布 | ヒストグラム / 密度 | ビン幅を \`d3.bin().thresholds(n)\` で決め、明記する |
| 構成比 | 積み上げ棒 / 100% 棒 | 円グラフは 2〜3 区分で差が大きいときだけ |
| 時系列 × 複数カテゴリ | 折れ線 + 直接ラベル、または small multiples | 積み上げ面は「合計」が主役のときだけ |
| 1 つの数字が主役 | 大きな数字 + 補足 1 行 | 8 色の棒より伝わる |
| 空間分布 | 地図 | 「地図の作法」スキルを参照 |

迷ったら棒か折れ線。3D・レーダー（次元が揃わないもの）・2 軸は使わない。

### 図種ごとの上限（超えたら図種か絞り方を変える）

- 円・ドーナツ: 区分 **≤ 5** で差がはっきりあるときだけ。0 / 負があれば不可 → 降順の横棒。
- 折れ線: 点が **5 以上**あり、x に順序があるときだけ。
- 縦棒: カテゴリ **≤ 20**（超えたら横棒 + 上位 N + その他）。
- グループ棒: 系列 **≤ 4〜5**（超えると 1 本が細すぎる → small multiples）。
- 積み上げ棒 / 積み上げ面: 子カテゴリ **≤ 5〜7**。系列個別の推移比較には不向き（基線が揃わない）→ 折れ線。
- 面（非積み上げ）の多系列: 不可（互いに隠れる）→ 折れ線か積み上げ。
- 散布図: **> 1 万点**は密度・格子集計へ。両軸ともカテゴリなら不可 → ヒートマップ（格子）。
- 箱ひげ: 各群 **≥ 5 点**。分布の形まで見せるなら **≥ 20 点**でバイオリン。
- ヒストグラム・密度曲線: 連続値専用（カテゴリは棒）。密度曲線は **≥ 30 件**。
- レーダー: 次元 **≤ 8**・単位が違う次元は先に正規化。基本は並べた棒で足りる。
- ヒートマップ（格子）: x / y が離散のとき。両方連続ならビン集計か等高線。

### 視覚チャネルの精度（どの属性に何を割り当てるか)

人が正確に読み取れる順: **位置 > 長さ（共通の基線）> 面積 > 色の濃淡 > 角度**。

- 量 → 位置（軸）> 長さ > 面積（\`scaleSqrt\`）> 色の濃淡。角度（円）は最後の手段。
- 種類 → 位置（分けて並べる）> 色相（≤ 8）> 形（≤ 6）。
- 順序 → 位置 > 大きさ > 単色ランプ。
- **一番伝えたい比較に、一番精度の高いチャネル（位置・長さ）を割り当てる**。色は 2 番目以降の変数に。

## 2. 配色の規則（最重要。必ず theme の値を使う）

色は「見た目」ではなく**仕事**で決める。1 つの図の中で、色がする仕事は 1 つ。

| 色の仕事 | 使う値 | 規則 |
|---|---|---|
| **系列の識別**（どの系列か） | \`theme.series\`（青・橙・緑青・黄・マゼンタ・緑・紫・赤の固定順） | **1 番目から順に**割り当てる。順番を飛ばさない・循環させない。\`d3.scaleOrdinal(theme.series)\` |
| **量**（どれだけ） | \`theme.sequential.blue5\` / \`d3.interpolateBlues\` など単色ランプ | 1 色を薄 → 濃。多色ランプは \`d3.interpolateViridis\` だけ。**虹色禁止** |
| **差・極性**（基準のどちら側） | \`d3.interpolateRdBu\` / \`theme.diverging\` | 赤 ↔ 青、中央は無彩色。中心は 0 か基準値 |
| **状態**（良い / 悪い） | \`theme.colors.positive\` / \`negative\` | 増減や合否に**だけ**使う。系列 4 番目の色に流用しない |
| **注目 vs 文脈** | 注目 = \`theme.colors.primary\`（青）、文脈 = \`theme.colors.context\`（グレー #8a8983） | 系列が 5 本以上で焦点があるときだけ。文脈グレーは**これより薄くしない** |
| **強調**（基本色の中で 1 つ） | \`theme.colors.accent\`（橙） | 青の棒の中で 1 本だけ橙、など。強調以外を薄くしない |

### 系列数で決める

- **1 本**: 全部 \`theme.colors.primary\`（青）。棒を値の大小で濃淡にしない（長さが既に量を示している）。
- **2〜4 本**: \`theme.series\` の 1〜4 番目（青・橙・緑青・黄）を順に。凡例 + 線の終端に直接ラベル。
- **5〜8 本**: 注目する 1〜2 本を \`theme.series\` から、残りは \`theme.colors.context\`（グレー）の細線（\`theme.line.context\`）。
  注目が無いなら small multiples（同じスケールで並べる）。
- **9 本以上**: 上位 7 本 + 「その他」に畳む、または small multiples。9 色目を作らない。
- **散布図・地図・small multiples** はどの 2 色も隣り合いうるので **\`theme.series\` の先頭 4 色まで**。それ以上は絞る・分ける。

### やってはいけない配色

- 薄いグレー・パステル・同系色（青系だけ、寒色だけ）で系列をまとめる → 何がどれか分からない、印刷で消える。
- 「注目以外」を \`#ccc\` や薄い水色にする → 文脈が読めない。文脈色は \`theme.colors.context\` 固定。
- 純色（\`#f00\` \`#0f0\` \`#00f\`）、黒（\`#000\`）の系列。
- 系列色で文字を書く（値・ラベル・凡例の文字はインク色 \`theme.colors.text\` / \`secondaryText\`、色は隣の丸や線で示す）。
- 量に虹色、名義カテゴリに濃淡ランプ、差の中央に色相。
- 白背景で 3:1 未満の色（緑青・黄・マゼンタ）を**ラベル無しの細い線**に使う → 使うなら太さ 2px 以上 + 直接ラベル。

### 具体例

\`\`\`js
const color = d3.scaleOrdinal().domain(seriesNames).range(theme.series)      // 系列 2〜4 本
const focus = new Set(['東京'])                                                 // 系列 5 本以上で注目がある
const stroke = (name) => (focus.has(name) ? theme.colors.primary : theme.colors.context)
const strokeWidth = (name) => (focus.has(name) ? theme.line.focus : theme.line.context)
const barFill = (d) => (d.name === highlight ? theme.colors.accent : theme.colors.primary) // 棒の 1 本強調
const seq = d3.scaleQuantize().domain([0, max]).range(theme.sequential.blue5)               // 量の階級
const div = d3.scaleDiverging([-max, 0, max], d3.interpolateRdBu)                          // 前年比などの差
\`\`\`

## 3. 視覚的階層（データ > 文字 > 軸 > グリッド）

\`\`\`text
データ            theme.series / theme.colors.primary（濃く・太く）
値・直接ラベル      theme.colors.text
サブタイトル・注釈   theme.colors.secondaryText
目盛り文字・出典     theme.colors.mutedText
軸線・基準線        theme.colors.axis
グリッド            theme.colors.grid（極細 1px）
\`\`\`

面（area・帯）は同じ色で \`fill-opacity: 0.25〜0.35\`、上に 2px の線。重なる点は \`stroke: #fff\` 1.5px の白縁で切り分ける。

## 4. マークの仕様

- 線: \`theme.line.normal\`（2px）、\`stroke-linecap/linejoin: round\`。注目 2.5px、文脈 1.5px。
- 点: 半径 \`theme.radius.point\`（4px、直径 8px 以上）。散布図は \`fill-opacity 0.6\` + 白縁 1px。
- 棒: \`padding(0.2〜0.3)\`。積み上げ・隣接の塗り同士は 2px の白い隙間（\`stroke: #fff; stroke-width: 2\`）。
- 直接ラベルは**選んで**付ける（終端・最大・最小・注目。全点には付けない）。
- 系列が 2 本以上なら凡例を置く（1 本ならタイトルが系列名）。凡例の並びはデータの順（終端の値の降順など）。

## 5. 12 の原則（要約）

1. データより目立つ装飾を作らない。 2. 色は意味に使う（上の表）。 3. 強調は 1 つか 2 つ。 4. 凡例より直接ラベル。
5. グリッドは薄く。 6. 余白を恐れない。 7. 数値は整形する（\`d3.format('.3~s')\` / \`','\` / \`.1%\`）。
8. 曲線で美化しない（\`curveLinear\`、せいぜい \`curveMonotoneX\`）。 9. ツールチップだけに情報を隠さない（\`<title>\` は補助）。
10. アニメーションは使わない（静止画で書き出す）。 11. \`viewBox\` を付ける。 12. タイトルは「何が分かるか」。

## 6. レイアウトと文字

- Margin convention: \`m = { top, right, bottom, left }\` を先に決め、\`innerWidth = width - m.left - m.right\`。
  - 上 56〜64px: タイトル + サブタイトル。下 40px: x 軸。左 48〜64px: y 軸の目盛り文字幅。右 80〜110px: 折れ線の直接ラベル分。
- 文字サイズは \`theme.font\`（title 20 / subtitle 13 / label 12 / axis 11 / note 10）。**8px 以下にしない**。
- 階層: タイトル（太字 650・\`text\`）→ サブタイトル（単位・期間・対象、\`secondaryText\`）→ 図 → 出典・注記（note、\`mutedText\`、右下か左下）。
- 単位は毎目盛りに繰り返さず、軸ラベルかサブタイトルに 1 回。
- ラベルが端で切れないかは目分量でなく **\`pretext\` で実測**する（§8 のラベル節）。余白は実測値から決める。

## 7. 軸のレシピ

\`\`\`js
g.call(d3.axisBottom(x).ticks(width / 80).tickSizeOuter(0))                    // x: 外側の目盛りを消し、本数はサイズから
  .call((g) => g.select('.domain').attr('stroke', theme.colors.axis))
  .call((g) => g.selectAll('text').attr('fill', theme.colors.mutedText))
g.call(d3.axisLeft(y).ticks(height / 40).tickFormat(d3.format('.2~s')))         // y: domain 線を消し、目盛り線をグリッドに
  .call((g) => g.select('.domain').remove())
  .call((g) => g.selectAll('.tick line').attr('x2', innerWidth).attr('stroke', theme.colors.grid))
  .call((g) => g.selectAll('text').attr('fill', theme.colors.mutedText))
const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.value)]).nice().range([height - m.bottom, m.top])
svg.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', theme.colors.axis) // 正負がある図の 0 線
\`\`\`

- 日付軸は \`d3.scaleUtc\`。目盛り書式は期間に合わせる（年 \`%Y\`、月 \`%Y-%m\` / \`%-m月\`、日 \`%-m/%-d\`）。
- カテゴリ軸は \`d3.scaleBand().padding(0.2〜0.3)\`。文字が重なるなら横棒（文字を回転させない）。

## 8. ラベル・凡例・注釈

### ラベルの 4 つの対処（重なる・読めないとき）

| 症状 | 対処 |
|---|---|
| ラベル同士が重なる | **ずらす**（y を押し出す簡易 dodge）か、重要なものだけ残して**隠す** |
| 図形に収まらない | **隠す**か、先端の外側へ出す（円は引き出し線） |
| 塗りの上で読めない | **白黒反転**（塗りの明るさで文字色を選ぶ） |
| 地図・画像・線の上で読めない | **縁取り**（halo）: \`paint-order: stroke\` + 白 \`theme.label.haloWidth\` |

\`\`\`js
// 終端ラベルの簡易 dodge（上から並べて最低間隔を確保する）
const items = series.map(([k, v]) => ({ k, y: y(v.at(-1).value) })).sort((a, b) => a.y - b.y)
const gap = theme.font.label + 3
for (let i = 1; i < items.length; i += 1) items[i].y = Math.max(items[i].y, items[i - 1].y + gap)
// 塗りの内側の文字色（明るい塗りは黒、暗い塗りは白）
const inside = (fill) => { const c = d3.rgb(fill); return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255 > 0.55 ? theme.label.insideDark : theme.label.insideLight }
// 縁取り（地図・塗りの上のラベル）
label.attr('paint-order', 'stroke').attr('stroke', '#ffffff').attr('stroke-width', theme.label.haloWidth).attr('stroke-linejoin', 'round')
\`\`\`

### テキストの実測と折り返し（pretext）

文字幅を目分量（0.6em × 文字数）で見積もらず、\`pretext\` で実測する。\`prepare\` 系の結果は同じ文字列・フォントで使い回す。

\`\`\`js
// 1 行の幅を実測（右余白・凡例の列幅・切り詰めの判定に使う）
const font = \`600 \${theme.font.label}px \${theme.font.family}\`
const widthOf = (t) => pretext.measureNaturalWidth(pretext.prepareWithSegments(String(t), font))
const m = { top: 56, right: Math.ceil(d3.max(names, widthOf)) + 16, bottom: 40, left: 56 } // 終端ラベルが必ず収まる余白

// 長すぎるラベルは実測で切り詰める（… を付ける）
const fit = (t, max) => { let s = String(t); while (s.length > 1 && widthOf(s + '…') > max) s = s.slice(0, -1); return s === String(t) ? s : s + '…' }

// 注釈・長い説明文を折り返して <tspan> にする
const noteFont = \`\${theme.annotation.fontSize}px \${theme.font.family}\`
const lineHeight = Math.round(theme.annotation.fontSize * 1.4)
const { lines } = pretext.layoutWithLines(pretext.prepareWithSegments(note, noteFont), 180, lineHeight) // 最大幅 180px
svg.append('text').attr('x', nx).attr('y', ny).attr('font-size', theme.annotation.fontSize).attr('fill', theme.colors.secondaryText)
  .selectAll('tspan').data(lines).join('tspan')
  .attr('x', nx).attr('dy', (d, i) => (i === 0 ? 0 : lineHeight)).text((d) => d.text)
\`\`\`


シーン別: 棒の内側の値 = 白黒反転 + 収まらなければ先端の外 / 密集折れ線 = 終端のみ + dodge + 右余白広め /
円の外側 = 引き出し線 + 小さい区分から隠す / 積み上げ・treemap の内側 = 白黒反転 + 小さい区画は出さない /
迷ったら = 重要なものだけ出し、重なったら隠す。

- ラベル位置は \`dx\` の手調整でなく「終端・先端の外・内側・外側 + 引き出し線」から選ぶ。値が小さいもの（全体の 3% 未満など）は出さない。
- 折れ線の系列名は線の終端に（\`x(last.date) + 8\`、\`dominant-baseline: middle\`、文字色はインク色、線色は隣の線が示す）。
- 棒の値は先端に（\`d3.format(',')\`）。値を書けば x 軸を薄くできる。

### 凡例

- **2 系列以上なら凡例を置く**。1 系列なら不要（タイトルが系列名を兼ねる）。
- 並びはデータの順（終端の値・合計の降順）。文字はインク色で、色は隣のマーカー
  （線・点系列は丸 \`theme.legend.markerSize\`、塗りは角丸四角 \`theme.legend.swatch\`）が示す。行間 \`rowGap\`・列間 \`colGap\`。
- 位置は右上か上。**円・ドーナツの外側ラベルと競合するときは下に置く**（か上余白を 60px 空ける）。
- 連続値は幅 \`theme.legend.continuousLength\` の帯（細い rect を 64 個並べる）+ 両端と中央の目盛り。
  階級は色見本 + 範囲ラベル + 「データなし」。**描画に使ったスケールそのものから作る**。

### 注釈

- 読み取りを助ける注釈を 1〜2 個。全点にラベルを付けない（極値・外れ値・注目対象だけ）。
- 参照線（平均・目標）: \`theme.annotation.line\` + \`stroke-dasharray: theme.annotation.dash\` + 幅 \`theme.annotation.width\`、
  右端に \`theme.annotation.fontSize\` のラベル。
- 範囲の帯（正常域・対象期間）: \`theme.annotation.bandFill\` + \`fill-opacity: theme.annotation.bandOpacity\`（主役より必ず弱く）。
- 強調する 1 点（最大値・異常値）: \`theme.annotation.highlight\` の丸 r5 + 値のラベル。

## 9. 図種ごとの要点

**折れ線**: \`d3.line().defined((d) => d.value != null)\` で欠損を切る。系列 1 本ならデータ点を打たず、点は強調箇所だけ。
予測・推計は破線（\`stroke-dasharray: '6 4'\`）で区別し、色だけに頼らない。

**棒**: 0 基準を崩さない。ランキングは横棒 + 降順ソート。全部 \`primary\`、強調 1 本だけ \`accent\`。
負の値は 0 から左右に伸ばし \`positive\` / \`negative\`。積み上げは \`d3.stack()\` + \`theme.series\` 順 + 2px の白い隙間。

**円・ドーナツ**（区分 ≤ 5・割合が主役・差が大きいときだけ）: \`d3.pie().sort(null).value((d) => d.value)\` + \`d3.arc()\`。
ドーナツは内径 55%（\`innerRadius(R * 0.55)\`）にして中心に合計値。色は \`theme.series\` を順に、区分の間は白 2px の \`stroke\`。
ラベルは外側 + 引き出し線で「名前 割合%」（重なったら小区分から隠す）。凡例は下。6 区分以上になったら降順の横棒に切り替える。

**散布図**: \`r: theme.radius.point\`、\`fill-opacity 0.6\`、白縁 1px。色分けは 4 群まで（\`theme.series\` 先頭 4 色）。注目点だけラベル。
傾向線は最小二乗（\`d3.sum\` で計算）を \`theme.colors.secondaryText\` の破線で。

**ヒストグラム**: \`d3.bin().value(...).thresholds(n)\`。全ビン \`primary\`、棒の間隔 1px。ビン幅と件数をサブタイトルに。

**Small multiples**: 同じスケール（y の domain を共有）で並べる。各パネルは同じ 1 色（\`primary\`）、比較対象があれば \`context\` の全体線を下敷きに。

## 10. 大量データ

- 描く要素は 5,000 個程度まで。超えるなら集計（\`d3.rollup\`）・サンプリング・ビン化。
- 散布図で 1 万点超なら canvas に描いて \`<image>\` として埋める（軸・ラベル・注釈は SVG のまま重ねる）。

## 11. よくある失敗（見つけたら直す）

1. 系列を薄いグレーやパステルで描く（見えない）。 2. 同系色だけでまとめる（区別できない）。 3. 系列の数だけ色を作る・循環させる。
4. 量に虹色、名義カテゴリに濃淡。 5. 黒い軸・濃いグリッドがデータと同じ強さ。 6. 全点にラベル。
7. 目盛りの本数が固定。 8. 滑らかな曲線で美化。 9. タイトルが変数名。 10. 0 を切った棒。 11. 2 軸。

## 12. 描く前・描いた後のチェック

- 一番伝えたいことを 1 文で言える → それがタイトル
- 色がする仕事が 1 つに決まっている（識別 / 量 / 差 / 状態 / 注目）。値は theme から取った
- 系列色は固定順、文脈グレーは \`theme.colors.context\`、文字はインク色
- 系列が 2 本以上なら凡例がある。直接ラベルは選んで付けた
- 余白が足りていて、ラベルが端で切れていない。目盛りが多すぎず、単位が分かる
- \`<title>\` があり、NaN / undefined の警告が無い

## 13. よくある事故と修正

- ❌ 凡例の色と図の色がずれる → ✅ 同じ \`color\` スケールを両方で使う（凡例用に別の配列を書かない）。
- ❌ 終端ラベルが右端で切れる → ✅ \`text-anchor: 'start'\` + 右余白 80〜110px。それでも収まらなければ線の内側へ。
- ❌ \`scaleUtc\` に日付**文字列**を渡して NaN → ✅ 先に \`d3.utcParse('%Y-%m-%d')\` で Date にする（date 列は文字列のまま入っている）。
- ❌ domain に null / NaN が混ざり属性が NaN → ✅ \`filter((d) => d.value != null)\` してから \`d3.extent\` / \`d3.max\`。
- ❌ 積み上げの並びが凡例と逆 → ✅ \`d3.stack().keys(keys)\` の keys と凡例の配列を**同じ順**にする。
- ❌ 一番薄い階級・面が背景に溶ける → ✅ 最小の階級は \`theme.sequential.blue5[0]\` より薄くしない。面は \`fill-opacity 0.25\` + 上に線。
- ❌ 棒の \`width\` / \`height\` が負になり消える → ✅ \`Math.max(0, x(v) - x(0))\` にするか domain の符号を確認。
- ❌ 系列色で文字を書いて読めない → ✅ 文字はインク色（\`theme.colors.text\`）、色は隣のマーカーが示す。`
