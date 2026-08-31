# スキルのデザイン向上プラン

> `reference/chart-visualization-skills/`（AntV のチャート生成スキル集）の調査結果を、
> 本アプリのスキル（`src/agent/skills/dataviz-*.js`）と theme（`src/viz/viz-theme.js`）に取り込む計画。
> 実装の進捗は末尾の「進捗」に追記する。

## Context

配色は検証済みパレット（固定順 8 色・文脈グレー `#8a8983`・単色ランプ・RdBu）に作り直したが、
図の「読みやすさ」を決める残りの要素 — 図種の選び方、ラベルと凡例の衝突、注釈、禁止事項の伝え方 — は
スキル文がまだ弱い。AntV のスキル集（423 ファイル）を調査し、**ライブラリ非依存で転用できる設計知識**と
**スキル文の書き方の型**を取り込む。

範囲（確定）:
- 対象は **`src/agent/skills/dataviz-*.js` と `src/viz/viz-theme.js`（+ それらのテスト）だけ**。
- フレームの自動デザイン検査・評価ループ（Harness Engineering）・viz-runtime の共通ヘルパーは
  **今回やらない**（末尾「今回やらないこと」に記録）。

調査で分かったこと（要点）:
- AntV の配色ドキュメントは「分類 / 順序 / 発散の 3 モード・8 色上限・赤緑回避」の一般論と AntV 標準色で、
  **配色そのものは今の theme の方が強い**（白背景での CVD・コントラスト検証済み）。取り込むのは配色の周辺。
- 転用価値が高いのは (1) 図種ごとの「使ってはいけない条件」表、(2) 視覚チャネルの精度順位、
  (3) ラベルの可視性規則（ずらす / 隠す / 縁取り / 白黒反転）とシーン別の組み合わせ、(4) 凡例と外側ラベルの衝突回避、
  (5) 注釈の色と不透明度の慣習、(6) 「白背景に白塗り」「幻覚パレット名」「頼まれていない装飾」の禁止。
- スキル文の型: `MUST:` 見出し + ❌/✅ の最小コード、他ライブラリ由来の幻覚 API の対応表 + 合法名ホワイトリスト、
  「ユーザー意図 → 読む節」の対応表、末尾に「よくある事故と修正」を蓄積。

---

## 1. 追加・変更する内容（ファイル別）

### 1.1 `src/viz/viz-theme.js` — トークンを 3 群追加（配色は変えない）

```js
annotation: { line: '#52514e', dash: '4 4', width: 1.2, bandFill: '#2a78d6', bandOpacity: 0.08, highlight: '#e34948', fontSize: 11 }
legend:     { markerSize: 8, rowGap: 8, colGap: 12, swatch: 14, continuousLength: 200, fontSize: 12 }
label:      { haloWidth: 3, minFontSize: 9, insideDark: '#0b0b0b', insideLight: '#ffffff' }
```
- `describeTheme` はそのまま（入れ子は再帰、配列は 1 行）。theme 表がスキルに自動反映される。
- 既存キーは変更しない（zip-template / png-export / テストが参照）。

### 1.2 `src/agent/skills/dataviz-workflow.js` — 3 節を追加

1. **「## 守る規則（MUST）」**（render 契約の直後、8 個以内、❌/✅ 最小コード）:
   白 / 近白の塗り禁止（例外: 内側ラベル文字・区切り白線）/ 色は theme から・系列色は固定順 8 色まで /
   量に分類色を使わない・差は 0 対称 domain / 頼まれていない装飾（影・グラデーション・3D・アニメ）を足さない・
   ユーザー指定のスタイルは必ず保持 / 文字 9px 未満と薄いグレー文字の禁止 / 内側ラベルは背景の明るさで白黒 /
   `viewBox` + `<title>` / 幻覚パレット名・幻覚 API 禁止
2. **「## D3 v7 に存在しない API（他版・他ライブラリからの混入）」** 対応表 + 合法名ホワイトリスト:
   `d3.schemeCategory20`→`theme.series`、`d3.scale.linear()`→`d3.scaleLinear()`、`d3.svg.axis()`→`d3.axisBottom()`、
   `d3.geo.path()`→`d3.geoPath()`、`d3.layout.pie()`→`d3.pie()`、`d3.time.format`→`d3.timeFormat`、
   `interpolateJet / Hot / Coolwarm / BlueOrange`→`Turbo / YlOrRd / RdBu / PuOr`、`d3.hexbin`（無い）→ 格子集計、
   `topojson.*`（無い）→ GeoJSON のまま。+ 実在する `d3.scheme*` / `d3.interpolate*` の一覧
3. **「## 迷ったときに読む節（意図 → read_reference）」** 12〜15 行の対応表（各スキル末尾の番号順 TOC は維持）

### 1.3 `src/agent/skills/dataviz-charts.js` — 5 か所を強化

1. §1 図の選び方に「使わない条件」列（円 ≤5・0/負不可 / 折れ線は点 ≥5 + 順序ある x / 縦棒 ≤20 カテゴリ /
   グループ棒 ≤4〜5 系列 / 積み上げ ≤5〜7 子カテゴリ / 非積み上げ多系列の面不可 / 散布図 >1 万点は密度へ・両軸カテゴリ不可 /
   箱ひげ ≥5・バイオリン ≥20 / ヒストグラムにカテゴリ不可 / レーダー ≤8 次元・単位差は正規化 / 連続×連続の cell は等高線）
2. 「## 視覚チャネルの精度」新節（位置 > 長さ > 面積 > 色濃淡 > 角度、データ型別の優先順、sqrt、8 種超の畳み方）
3. §8 ラベル・注釈の書き直し（ずらす / 隠す / 縁取り / 白黒反転の 4 対処 + 簡易 dodge・輝度判定スニペット +
   シーン別組み合わせ表 + 注釈は `theme.annotation`）
4. 「## 凡例」新節（2 系列以上で必須・寸法は `theme.legend`・連続凡例 200px・外側ラベルとの衝突は凡例を下へ）
5. §9 に「円・ドーナツ」追加（使う条件とレシピ）+ 「## よくある事故と修正」新節（初期 8 件）

### 1.4 `dataviz-maps.js` / `dataviz-geojson.js` / `dataviz-raster.js`

- 冒頭に「## 守る規則（MUST）」（各 4〜6 個）、末尾（TOC の前）に「## よくある事故と修正」（各 4〜6 件）
- maps: 凡例に `theme.legend` の寸法、ラベルに白黒反転を 1 行追記

### 1.5 テスト

- `test/dataviz-viz.test.js`: theme 表に `annotation` / `legend` / `label`、workflow の新 3 節の見出し
- `test/reference-index.test.js`: 5 スキルに「守る規則（MUST）」、4 スキルに「よくある事故と修正」、
  意図表の節番号が実在すること、合計文字数上限 40k → **50k**
- `test/viz-export.test.js`: 変更なし

### 1.6 docs

- `CLAUDE.md`: スキルの構成（MUST → 本文 → 事故集 → 目次）と「事故を見つけたら事故集に追記」の運用を 1 行

## 2. 実装順序

| 段 | 内容 | 確認 |
|---|---|---|
| 1 | theme トークン追加 | `npm test` |
| 2 | workflow: MUST / 幻覚 API 表 / 意図表 | テスト更新・lint |
| 3 | charts: 図種条件・チャネル・ラベル・凡例・円・事故集 | 同上 |
| 4 | maps / geojson / raster: MUST・事故集 | TOC 一致・意図表の節番号実在 |
| 5 | 目視: フレーム直叩きで 4 図（終端 dodge 折れ線 / 内側ラベル棒 / 円 + 下凡例 / 参照線・帯） | PNG 送付 |
| 6 | CLAUDE.md / Plan.md 更新、build | build 成功 |

## 3. 検証

- `npm run lint` / `npm test` / `npm run build`
- 段 5 の 4 図を目視（ラベルが重ならない・内側ラベルが読める・凡例が外側ラベルと重ならない・注釈が主役より弱い）
- 任意（課金あり）: 実 API キーで 3 依頼を投げて生成コードが規則に従うか確認

## 4. 今回やらないこと（将来候補）

1. **フレームの自動デザイン検査**: `collectWarnings` に「theme 外の hex」「白背景に白塗り」「塗りの色数 > 8」「文字 < 9px」を追加
2. **評価ループ（Harness Engineering の最小構成）**: `eval/` にサンプル依頼 20〜30 件 → 実 API で描画 →
   success / blank / 警告数を集計 → スキル変更前後で回帰比較（「描画できたか」を合否に、blank 検出、fail-open の VL judge）
3. **viz-runtime の共通ヘルパー**: 凡例・ラベル dodge・ハロー・数値書式を `render({ viz })` で渡す
4. **ダークテーマ**: 書き出しは白背景固定のため対象外
5. **意図検索**: `read_reference` に自然言語 `query`

## 追記: pretext の導入（テキスト計測・折り返し）

[chenglou/pretext](https://github.com/chenglou/pretext)（npm: `@chenglou/pretext` 0.0.8、MIT）を導入した。
DOM リフローなしにテキストを計測・折り返しできる純 JS ライブラリ（canvas measureText + `Intl.Segmenter`）。
これまで「1 文字 ≒ 0.6em」の目安で決めていたラベル処理を実測に置き換える。

- **同梱**: `src/viz-runtime/index.js` で `window.pretext` に公開（`VIZ_RUNTIME_VERSION` を 2 に。
  viz-runtime.js は 951KB / gzip 287KB、+49KB）。フレーム（`public/viz-frame.js`）と zip の起動コード
  （`viz/zip-template.js`）の両方が render 引数 `pretext` として渡す。
- **使いどころ（スキルに記載）**:
  - `measureNaturalWidth(prepareWithSegments(text, font))` — 終端・値ラベルの**実測幅から余白を決める**、
    凡例の列幅、長いラベルの**切り詰め（… 付き）**判定
  - `layoutWithLines(prepared, maxWidth, lineHeight)` — **注釈・長文を折り返して `<tspan>`** にする
- **スキル更新**: workflow（render 契約の引数・ライブラリ一覧）/ charts §6（目安 → 実測）・§8 に
  「テキストの実測と折り返し（pretext）」のレシピ / maps §8 に地名幅の実測を 1 行。
- **検証**: サンドボックスのフレーム内（CSP `connect-src 'none'`）で動作を実測 — 右余白 220px の自動算出、
  「マーケティングコミュニケーション部」の切り詰め、注釈 49 文字 → 200px 幅 3 行の折り返し。警告 0。
  テスト 130 件 / lint 0 / build 成功。

## 進捗

- **完了（2026-08-31）**: 段 1〜6 をすべて実施。
  - theme に `annotation` / `legend` / `label` トークンを追加（配色は変更なし）。
  - workflow: 「守る規則（MUST）」8 条・「D3 v7 に存在しない API」対応表 + 実在する色スケール一覧・
    「迷ったときに読む節（意図 → read_reference）」14 行。
  - charts: MUST 6 条・図種ごとの上限・視覚チャネルの精度・ラベル 4 対処（dodge / 白黒反転 / halo のスニペット付き）+
    シーン別表・凡例節・注釈節（theme.annotation）・円 / ドーナツのレシピ・事故集 8 件。
  - maps / geojson / raster: MUST 各 5〜6 条 + 事故集 各 5〜6 件。
  - テスト: theme トークンの表出・新節見出し・全スキルの MUST / 事故集・意図表の節番号が実在すること（計 130 件）。
    スキル合計は 43,354 文字（上限 50k に緩和）。
  - フレーム直叩きで 4 図（終端 dodge 折れ線 / 内側ラベル反転の積み上げ横棒 / ドーナツ + 引き出し線 + 下凡例 /
    参照線・帯・強調点）を描いて目視確認。lint 警告 0 / テスト 130 件 / build 成功。
