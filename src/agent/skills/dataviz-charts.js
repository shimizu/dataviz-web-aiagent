// 一般チャート（折れ線・棒・散布図など）を美しく作るための指針スキル（Markdown 文字列・決定的）。
//
// 役割: reference/d3js_beautiful_dataviz_guide.md（2,474 行）を、Claude が render コードを書くときに
//       効く「判断規則と D3 のレシピ」に圧縮したもの。揮発情報は含めない。
// 関係: tools/dataviz/index.js が skills に載せる。詳細節は read_reference('dataviz', '<節番号>') で取得できる（M5 で追加）。
// 流用元: reference/d3js_beautiful_dataviz_guide.md §1・§3〜§11・§16〜§17・§20〜§21
export const DATAVIZ_CHARTS_SKILL = `# スキル: チャートの作法（折れ線・棒・散布図・分布）

## 1. 図の選び方は「読み手が何を比較するか」で決める

| 伝えたいこと | 第一候補 | 補足 |
|---|---|---|
| 時系列の変化 | 折れ線 | 系列が多ければ注目系列以外をグレーに、または small multiples |
| カテゴリ間の大小 | 棒（縦） | 0 を基準線にする。角度・面積より「同じ基準線からの長さ」が読みやすい |
| 順位 | 横棒を値でソート | 長いカテゴリ名も読める |
| 2 変数の関係 | 散布図 | 傾向線を重ねると「個別」と「全体」が分かれる |
| 分布 | ヒストグラム / 密度 | ビン幅を \`d3.bin().thresholds(d3.thresholdSturges)\` などで決め、明記する |
| 構成比 | 積み上げ棒 / 100% 棒 | 円グラフは 2〜3 区分で差が大きいときだけ |
| 時系列 × 複数カテゴリ | 折れ線 + 直接ラベル、または small multiples | 積み上げ面は「合計」が主役のときだけ |
| 空間分布 | 地図 | 「地図の作法」スキルを参照 |
| 値の表 | 表のまま | 数値を正確に読ませたいなら図にしない選択もある |

迷ったら棒か折れ線。円グラフ・ドーナツ・レーダー・3D は原則使わない。

## 2. 12 の原則（効果が大きい順ではなく、すべて守る）

1. **データより目立つ装飾を作らない** — 軸・グリッド・枠・背景はデータより弱く。
2. **色は意味に使う** — 注目 = アクセント、比較対象 = 中間色、その他 = グレー。10 系列に 10 色を機械的に割り当てない。
3. **強調は 1 つか 2 つ** — 全部を目立たせると何も目立たない。
4. **凡例より直接ラベル** — 折れ線の終端、棒の先端に名前や値を書く。
5. **グリッドは薄く** — 目盛り線を伸ばして使う。色は \`theme.colors.grid\`。
6. **余白を恐れない** — タイトル・ラベル・注釈のための余白を先に確保する。
7. **数値は整形する** — \`d3.format('.3~s')\`（1.2k / 1.25M）、\`d3.format(',')\`（12,000）、割合は \`.1%\`。
8. **曲線で美化しない** — \`curveLinear\` を既定に。滑らかにするなら \`curveMonotoneX\` まで（\`curveBasis\` 等は実在しない極値を暗示する）。
9. **ツールチップだけに情報を隠さない** — 主要な値は常時表示。ホバーは補助（各マークの \`<title>\` で十分）。
10. **アニメーションは使わない**（このアプリでは静止画として書き出す）。
11. **viewBox を付ける** — \`svg.attr('viewBox', [0, 0, width, height])\`。
12. **タイトルは「何が分かるか」** — 「年別売上」ではなく「売上は 2024 年以降、再び増加に転じた」。

## 3. 視覚的階層

\`\`\`text
データ            100%   theme.colors.primary（注目）/ theme.colors.muted（その他）
ラベル・値          70%   theme.colors.text / theme.colors.mutedText
軸線・目盛り文字     40%   theme.colors.axis / theme.colors.mutedText
グリッド            15%   theme.colors.grid
\`\`\`

黒（\`#000\`）と純色（\`#f00\` \`#0f0\` \`#00f\`）は使わない。面（area・塗り）は線より彩度と不透明度を下げる
（例: 線 \`theme.colors.primary\` 幅 2、面は同色で \`fill-opacity: 0.16\`）。

## 4. レイアウトと文字

- Margin convention: \`m = { top, right, bottom, left }\` を先に決め、\`innerWidth = width - m.left - m.right\`。
  - 上 56〜64px: タイトル + サブタイトル。下 40px: x 軸。左 48〜64px: y 軸の目盛り文字幅。
  - 右 80〜110px: 折れ線の直接ラベルを置くなら広く取る。横棒は左をカテゴリ名の幅に合わせる。
- 文字サイズは \`theme.font\`（title 20 / subtitle 13 / label 12 / axis 11 / note 10）。**8px 以下にしない**。
- 階層: タイトル（太字・\`theme.colors.text\`）→ サブタイトル（単位・期間・対象、\`mutedText\`）→ 図 → 出典・注記（note サイズ、右下か左下）。
- 単位は毎目盛りに繰り返さず、軸ラベルかサブタイトルに 1 回書く（\`%\` や通貨のように単独で意味が曖昧なものは目盛りに付けてよい）。
- ラベルが端で切れていないか、数字の桁数から必要幅を見積もる（1 文字 ≒ フォントサイズ × 0.6px、日本語は × 1.0）。

## 5. 軸のレシピ

\`\`\`js
// x 軸: 外側の目盛りを消し、本数はサイズから決める
g.call(d3.axisBottom(x).ticks(width / 80).tickSizeOuter(0))
// y 軸: 縦の domain 線を消し、目盛り線を横いっぱいに伸ばして薄いグリッドにする
g.call(d3.axisLeft(y).ticks(height / 40).tickFormat(d3.format('.2~s')))
  .call((g) => g.select('.domain').remove())
  .call((g) => g.selectAll('.tick line').attr('x2', innerWidth).attr('stroke', theme.colors.grid))
  .call((g) => g.selectAll('text').attr('fill', theme.colors.mutedText))
// 量のスケールは nice() で読みやすい境界に
const y = d3.scaleLinear().domain([0, d3.max(data, (d) => d.value)]).nice().range([height - m.bottom, m.top])
// 正負がある図は 0 の基準線をグリッドより少し濃く
svg.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', theme.colors.axis)
\`\`\`

- 日付軸は \`d3.scaleUtc\`。目盛り書式は期間に合わせる（年: \`%Y\`、月: \`%Y-%m\` または \`%-m月\`、日: \`%-m/%-d\`）。
- カテゴリ軸は \`d3.scaleBand().padding(0.2〜0.3)\`。カテゴリが多く文字が重なるなら横棒にする（文字を回転させない）。
- 目盛り文字の色は \`theme.colors.mutedText\`、軸線は \`theme.colors.axis\`。

## 6. 色のレシピ

| データの性質 | スケール | 例 |
|---|---|---|
| 種類（名義） | \`d3.scaleOrdinal(d3.schemeTableau10)\` または \`d3.schemeObservable10\`。**必要な色数だけ** | 地域・製品 |
| 量（一方向） | \`d3.scaleSequential(d3.interpolateBlues)\`、\`interpolateViridis\`、\`interpolateYlGnBu\` | 人口密度・降水量 |
| 基準からの差 | \`d3.scaleDiverging([min, 0, max], d3.interpolateRdBu)\`（中心を 0 や平均に） | 前年比・気温偏差 |
| 注目 vs その他 | 注目 = \`theme.colors.primary\`、その他 = \`theme.colors.muted\` | ランキングで自分の都市だけ |
| 正 / 負 | \`theme.colors.positive\` / \`theme.colors.negative\` | 増減 |

- 虹色（\`interpolateRainbow\`・\`schemeCategory10\` の機械的割り当て）は使わない。
- 色だけで区別しない。予測値は破線（\`stroke-dasharray: '6 4'\`）、系列は直接ラベル、正負は形や位置でも示す。
- 系列が 4 つを超えたら「注目 1〜2 本 + 残りはグレー」か small multiples。

## 7. ラベル・注釈

- 折れ線の系列名は線の終端に（\`x(last.date) + 8\`、\`dominant-baseline: middle\`）。重なるなら y を少しずらすか、上位だけ表示。
- 棒の値は先端に書く（\`d3.format(',')\`）。値を書けば x 軸を薄くできる。
- 読み取りを助ける注釈を 1〜2 個（「2024 年から増加が加速」）。全点にラベルを付けない（極値・外れ値・注目対象だけ）。
- 参照線（平均・目標）は \`stroke-dasharray: '4 4'\`、\`theme.colors.axis\`、右端に小さくラベル。
- 凡例が必要なら: 並び順をデータの順（終端の値の順）に揃え、名前を短くし、線種も示す。

## 8. 図種ごとの要点

**折れ線**: \`d3.line().defined((d) => d.value != null)\` で欠損を切る（勝手につながない）。\`stroke-linecap/linejoin: round\`。
注目系列 \`theme.line.focus\`（2.5）、その他 \`theme.line.normal\`（1.5）。系列 1 本ならデータ点を打たず、点は強調箇所だけ。

**棒**: 0 基準を崩さない。ランキングは横棒 + 降順ソート。1 色 + 強調 1 色。\`padding(0.2〜0.3)\`。
負の値があれば 0 から左右（上下）に伸ばし、基準線を描く。積み上げは \`d3.stack()\`、順序は意味順（大→小 or 固定）。

**散布図**: \`r: theme.radius.point\`、\`fill-opacity: 0.45〜0.6\`、細い \`stroke\`（同系色の濃い色、0.6px）で重なりに強くする。
注目点だけラベル。傾向線は \`d3.regressionLinear\` が無いので自前の最小二乗（\`d3.sum\` で計算）か、\`d3.line\` で移動平均。

**ヒストグラム**: \`d3.bin().value(...).thresholds(n)\`。ビン幅と件数をサブタイトルに書く。棒の間隔は 1px。

**Small multiples**: 同じスケール（y の domain を共有）で並べる。1 枚ごとにタイトルを小さく、軸は左端と下端だけ。

## 9. 大量データ

- 描く要素は 5,000 個程度まで。超えるなら集計（\`d3.rollup\`）・サンプリング・ビン化を先に行う。
- 散布図で 1 万点超なら canvas に描いて \`<image>\` として埋める:
  \`const c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d'); …; svg.append('image').attr('href', c.toDataURL()).attr('width', w).attr('height', h)\`。
  軸・ラベル・注釈は SVG のまま重ねる。

## 10. よくある失敗（見つけたら直す）

1. 黒い軸・黒い目盛り・濃いグリッド・濃いデータ線がすべて同じ強さ。
2. 系列の数だけ色を割り当てる。
3. 量に虹色。
4. 全点にラベル。
5. グリッドがデータより濃い。
6. ツールチップにしか値が無い。
7. 目盛りの本数が固定（\`ticks(20)\`）。
8. 滑らかな曲線でデータを美化。
9. タイトルが変数名（「人口」「売上」）。
10. 0 を切った棒グラフ。

## 11. 描く前・描いた後のチェック

- 一番伝えたいことを 1 文で言える → それがタイトルになっている
- 読み手が比較する対象に合った図種か（棒なら 0 基準、時系列なら折れ線を先に検討）
- 余白が足りていて、ラベルが端で切れていない
- 目盛りが多すぎず、数値の書式と単位が分かる
- 色に役割があり、注目対象が最も目立ち、色だけに頼っていない
- 凡例を直接ラベルに置き換えられないか検討した
- \`<title>\` があり、NaN / undefined の警告が無い`
