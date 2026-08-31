# 可視化デザイン向上・第 2 期プラン（見せて直させる + 道具に焼き込む）

> 第 1 期（検証済みパレット・スキルの MUST / 事故集・pretext。2026-08-31 完了、詳細は git 履歴の本ファイル前版）で
> 「壊れた図」は減ったが、「見づらい・ダサい」は解消していない。原因はプロンプト層ではなく
> **フィードバックループとライブラリ層**にあるため、第 2 期はそこを直す。
> 実装の進捗は末尾の「進捗」に追記する。

## Context — なぜまだダサいのか（診断）

1. **エージェントは自分の図を一度も見ていない。** `render_visualization` が返すのはテキスト
   （`summarizeRender`: 要素数・警告文言）だけで、`collectWarnings` も機械的な壊れ方
   （svg 空・NaN・`<title>` 無し）しか検出しない。ラベルの重なり・窮屈な余白・崩れた階層は不可視。
   自己修正は `is_error` でしか回らず、システムは「エラーなく描けた」に収束する。
2. **デザインは規則の列挙では書けない。** スキル 44k 文字は事故を防ぐ床にはなるが、
   見栄えを決める連続的な微調整（余白のリズム・目盛り密度・揃え）は文章に分解できない。
3. **素の D3 では毎回すべてが手作り。** 凡例・dodge・余白をスニペット頼みに毎回再実装させており、
   品質を毎回「再獲得」しなければならない。良い図を出すツールはデザイン判断を既定値に焼き込んでいる。
4. **モデルの D3 事前分布はチュートリアル品質**（v3 の書き方・詰まった余白）。生成負荷が高いほど
   長い規則より事前分布が勝つ（幻覚 API 表が必要になったこと自体が証拠）。
5. **計測していないものは改善しない。** 検証が手選び数図の目視のみで、施策の効果を測る装置が無い。

対策の 2 本柱:
- **Observable Plot の導入** — 基本チャートは Plot の宣言的仕様で作らせ、仕上げ・注釈だけ d3 で足す。
  デザイン判断をライブラリの既定値に移し、モデルに与える自由度（= 事故率）を減らす（原因 2・3・4）。
- **PNG フィードバック** — 描画結果の画像を tool_result で Claude 自身に見せ、
  自己批評 → update の 1〜2 巡を描画手順に組み込む（原因 1）。フレームの警告にも幾何学的な
  デザイン検査（重なり・切れ・色数）を足し、機械検出できるものは機械に検出させる。

範囲（確定）: 対象は viz-runtime / フレーム / `src/agent/runtime.js` / dataviz ツール / スキル（+ テスト・docs）。
評価ループ（回帰測定）と地図の Plot 化は**今回やらない**（末尾に記録）。

---

## 1. 追加・変更する内容（ファイル別）

### 1.1 Observable Plot の同梱（viz-runtime v3）

- `package.json`: `@observablehq/plot`（^0.6 で固定。d3 は既存と共有されるため増分は限定的 — ビルド後に実測を追記）。
- `src/viz-runtime/index.js`: `import * as Plot from '@observablehq/plot'` → `scope.Plot = Plot`、
  `VIZ_RUNTIME_VERSION` を `'3'` に。
- `public/viz-frame.js` / `src/viz/zip-template.js`: render 引数に `Plot` を追加（両方同期して更新）。
- **単一 svg 契約は変えない**。Plot の `title` / `subtitle` / `caption` / 凡例オプションは
  `<figure>` + HTML 要素を生成して書き出し（SVG/PNG/ZIP）を壊すため**禁止**。
  タイトル・サブタイトル・出典・凡例は既存の d3 レシピ（`theme.legend` 等）で**外側 svg** に描き、
  `Plot.plot()` が返す svg を `<svg x y>` として入れ子にする（SVG として合法・書き出しも通る）。
- CSP: Plot は eval 不使用の想定だが、CLAUDE.md の規則どおり `npm run build && npm run preview` を
  Chromium で実測してから確定する。

### 1.2 スキルの Plot-first 化

- `src/agent/skills/dataviz-workflow.js`:
  render 契約・ライブラリ一覧に `Plot` を追加。MUST に
  「**Plot の figure を生成するオプション（title / caption / legend）を使わない** — 単一 svg 契約が壊れる」を追加。
- `src/agent/skills/dataviz-charts.js`: 「まず Plot の仕様で書く → 足りない装飾だけ `d3.select(svg)` で足す」を軸に書き直す。
  1. **「Plot 共通オプション」ブロック**（theme との整合）: `style: { fontFamily: theme.font.family, fontSize: ... }`、
     `color: { range: theme.series }`、余白は外側 svg 側で管理 — をコピーして使う決定的なスニペットで示す。
  2. 図種別レシピを Plot マークに置換: 折れ線 `Plot.lineY`（+ `Plot.ruleY([0])`）/ 棒 `Plot.barY` `barX` /
     積み上げ（`Plot.stackY`）/ 面 `Plot.areaY` / 散布 `Plot.dot` / ヒストグラム `Plot.rectY` + `Plot.binX` /
     箱ひげ `Plot.boxY` / small multiples は **`fx` / `fy` ファセット**（現状スキルの弱点を Plot が最も補う箇所）。
  3. d3 仕上げレシピは残す: 終端ラベル dodge・参照線 / 帯 / 強調点（`theme.annotation`）・pretext の実測・凡例。
  4. **円・ドーナツは d3 のまま**（Plot の守備範囲外）。「よくある事故と修正」に Plot 由来の枠を新設
     （例: ❌ `Plot.plot({ title })` で figure が返り svg が無い警告 → ✅ タイトルは外側 svg に描く）。
- `dataviz-maps.js` / `dataviz-geojson.js` / `dataviz-raster.js`: **変更なし**（地図・ラスタは d3 + geoWarp のまま。
  現行の read_reference ガイドの方が Plot の geo マークより強い）。

### 1.3 フレームのデザイン検査（`public/viz-frame.js` の `collectWarnings` 拡張）

機械検出できるデザイン事故を警告化する（エージェントは warnings に既に反応する）:

- `<text>` 同士の `getBBox()` 衝突（重なりペア数。text が 300 個超なら計測をスキップして旨を警告）
- viewBox からはみ出す / 端で切れる `<text>`
- 塗り（fill）の**色数 > 8**（白・グレー・theme の無彩色は除外）
- theme パレット外の hex の塗り（theme は render 要求で受け取っているものを照合に使う）
- `font-size` < 9px の文字
- 白背景での近白 fill（面積のある図形。内側ラベル文字・区切り線は除外）

DOM（getBBox）依存のため node テスト対象外。Playwright の preview 実測で発火を確認する（既存方針どおり）。

### 1.4 PNG フィードバック（描画結果を Claude に見せる）

- `src/agent/runtime.js`: ツール戻り値に `_image: { data, media_type }` があれば tool_result の `content` を
  `[{ type: 'image', source: {...} }, { type: 'text', text: 要約 }]` の配列にする。
  `TOOL_RESULT_CHAR_CAP` は**テキスト部にのみ**適用。`compaction.js` は content 全体をプレースホルダ文字列に
  置換するため画像も自動で縮約される（配列 content でも動くことをテストで確認）。
- `src/viz/png-export.js`: `svgToPngBase64({ maxWidth: 800, scale: 1 })` を追加（既存 `svgToCanvas` の 3 行の包み。
  チャートの細線・文字は JPEG アーティファクトが出るため PNG。800×500 で 1 枚 ≈ 700 トークン）。
- `src/tools/dataviz/visualization-handlers.js`: 描画成功時に deps 注入の `snapshotSvg(svg)` で画像を作り
  `_image` として返す（**直接 import しない** — DOM 依存で node テストが壊れるため。失敗時・未注入時は従来どおり）。
- `src/App.jsx`: `agentDeps` に `snapshotSvg` を追加（png-export を結線。参照安定に注意）。
- `src/agent/skills/dataviz-workflow.js`: MUST に自己批評の手順を追加 —
  「render の結果画像を必ず見て、①ラベルの重なり・切れ ②余白と詰まり ③視覚階層（主役が主役か）
  ④凡例と色の対応 を点検し、直せる問題があれば update_visualization で直す（**最大 2 回**。それ以上は現状を報告）」。
- `claude-client.js` は直叩き fetch のため画像ブロックはそのまま通る想定（モック E2E で確認）。
  音声の `look_at_visualization`（Gemini 向け JPEG）とは経路も役割も独立。

### 1.5 テスト

- `test/runtime.test.js`: `_image` 付き結果 → content が画像 + テキストの配列 / 文字列結果は従来どおり /
  cap がテキスト部だけに効く / compaction が配列 content もプレースホルダ化する
- `test/dataviz-viz.test.js`: 偽 deps の `snapshotSvg` が成功時に呼ばれ画像が載る・失敗時と未注入時は載らない /
  workflow スキルの新 MUST 見出し
- `test/reference-index.test.js`: charts 書き直し後も MUST / 事故集 / TOC / 節番号のテストが通ること（合計文字数は減る見込み）
- `test/viz-export.test.js`: zip の viz.js が `Plot` を render に渡すこと

### 1.6 docs

- `CLAUDE.md`: render 引数（`Plot` 追加・runtime v3）、単一 svg 契約と Plot の figure 禁止、
  tool_result のリッチ形式（`_image`）と自己批評ループを追記
- `docs/architecture.md` / `docs/agent-loop.md` / `docs/extending.md` の該当箇所を同期

## 2. 実装順序

| 段 | 内容 | 確認 |
|---|---|---|
| 1 | Plot 同梱（runtime v3・frame・zip・契約） | `npm run preview` で CSP・サイズ実測 |
| 2 | workflow / charts スキルの Plot-first 化 | `npm test`・lint（TOC / 節番号 / 文字数） |
| 3 | フレームのデザイン検査 | Playwright で警告の発火を実測 |
| 4 | runtime のリッチ tool_result + compaction | `node --test test/runtime.test.js` |
| 5 | PNG フィードバック結線（png-export・handlers・App・スキル） | モック E2E（`page.route`）で往復確認 |
| 6 | 目視 6 図 + docs 更新 + build | build 成功・PNG 送付 |

## 3. 検証

- `npm run lint` / `npm test` / `npm run build`
- Playwright モック E2E（`~/.claude/debug.md` の手順）: render → **画像付き tool_result** → update までの 1 往復
- 目視 6 図: Plot 折れ線 + 終端 dodge / Plot 積み上げ棒 / Plot ファセット（small multiples）/ Plot 散布 + 傾向線 /
  d3 ドーナツ（回帰）/ 地図 1 枚（回帰。maps 系が壊れていないこと）
- デザイン検査の発火確認: わざと「重なるラベル」「9 色」「8px 文字」を描いて警告が出ること
- 任意（課金あり）: 実 API キーで 3 依頼を投げ、自己批評ループが 1〜2 巡で止まり、図が改善するか確認

## 4. 今回やらないこと（将来候補）

1. **評価ループ（回帰測定）**: `eval/` にサンプル依頼 20〜30 件 → 実 API で描画 → 警告数・自己批評の巡数・
   VL judge のスコアを集計し、スキル / 既定値の変更前後で比較する。第 2 期で judge 相当を生成ループ内に
   入れるため、次期はその結果を「測る」側に回す。
2. **地図の Plot 化**: Plot の geo マークより現行の d3 + read_reference ガイドが強い。差が縮まったら再検討。
3. **viz-runtime のレイアウトヘルパー**: Plot が大半を代替する。残るのは凡例ヘルパーのみで、
   スキルのレシピで足りるかを第 2 期の結果で判断。
4. **ダークテーマ**（書き出しは白背景固定）/ **意図検索**（`read_reference` に自然言語 `query`）。

## 進捗

- **完了（2026-08-31）**: 段 1〜6 をすべて実施。
  - 段 1: `@observablehq/plot` 0.6.17 を viz-runtime v3 に同梱（`window.Plot`、runtime 1,155KB / gzip 355KB、+68KB gzip）。
    frame / zip の render 引数に `Plot`。`<figure>` は凡例 svg を誤って書き出すためフレームで修正方法付きエラーに。
    本番 CSP 下（preview + Chromium）で描画・入れ子・書き出しを実測確認。
  - 段 2: charts スキルに §2「まず Plot で組む」（外側 svg + 入れ子の型・`chart.scale().apply()` の仕上げ・tidy 化・
    時間軸の日本語 tickFormat）、図種レシピを Plot マークに置換（円・ドーナツは d3 のまま）。workflow の模範 render 例を
    Plot 型に書き換え。**実測で見つけた事故**: Plot 内蔵 CSS（`height:auto` / `max-width:100%`）が入れ子 svg の属性を
    上書きし内容が +32px ずれる → frame / zip で width / height 属性をインラインスタイルへ焼き込む補正を実装。
  - 段 3: `collectWarnings` にデザイン検査（ラベル重なり・端切れ・9px 未満・塗り色相 12 バケツで 8 超・近白塗り）。
    悪い図で全 5 警告の発火・Plot の良い図で誤検知ゼロを実測。theme 外 hex の照合はランプ補間色が誤検知になるため見送り。
  - 段 4: runtime に `_image` → 画像 + テキストの tool_result（cap はテキストのみ）。終了時に `stripToolResultImages` で
    画像をプレースホルダへ畳み localStorage 永続化を守る。compaction の配列 content 対応をテストで確認。
  - 段 5: `svgToPngBase64`（maxWidth 800・PNG）→ handlers が deps 注入の `snapshotSvg` で `_image` 同梱 →
    App の `agentDeps` に結線。workflow スキルに MUST 10（画像を見て重なり・切れ・余白・階層・凡例を点検、
    update は最大 2 回）。
  - 段 6: 目視 6 図（Plot 折れ線 + 終端ラベル / 積み上げ + 上凡例 / fy ファセット / 散布 + 回帰破線 /
    d3 ドーナツ + 引き出し線 + 下凡例 / d3 コロプレス + halo。全図警告 0）。テスト 134 件 / lint 0 / build 成功。
  - 副産物: 巻き方向が逆の GeoJSON（地球全体が塗られる事故）でデザイン検査が正しく発火することを確認。
