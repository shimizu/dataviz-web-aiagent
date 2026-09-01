# 可視化デザイン向上・第 3 期プラン（Lieflat の視覚言語 + Web フォント）

> 第 2 期（Plot 導入・PNG 自己批評・デザイン検査。完了、詳細は git 履歴の本ファイル前版）に続き、
> `reference/lieflat-charts-skills/`（moxt.ai の Lieflat Charts）の調査結果から**ライブラリ非依存の視覚言語**を取り込み、
> あわせてフォントを **日本語 = Noto Sans JP / 英数字 = Roboto Condensed** の Web フォントに切り替える。
> 実装の進捗は末尾の「進捗」に追記する。

## Context — Lieflat 調査で分かったこと（要点）

Lieflat は「テンプレート複写 + トークンの単一正本（`mono-tokens.js`）」で LLM の品味ばらつきを殺す設計。
アーキテクチャ（64 枚の gallery 複写）は取り込まないが、視覚言語は数値レベルで転用できる:

1. **タイポの強い階層**: タイトル 700/-0.02em・図内数値 800・軸 600・出典行 500/+0.08em。
   ウェイト差（400 vs 700/800）が「デザインされて見える」大部分を担う。現 theme はサイズのみでウェイト規定が無い。
2. **カードの解剖学（四点セット）**: 結論式タイトル → **凡例・単位・期間を `·` 区切りの契約文で書くサブタイトル**
   （例: 「1 点 = 1%・白抜き = 週末」）→ 図 → 出典行（字間広め）。
3. **家具（無データの環境構造層）**: 疎データの図が貧相なのはデータ層でなく家具の不足
   （帳簿線・破線レール・リム目盛り・引出線。実測で線の 7 割が 0.5〜1px の発丝線）。
4. **単位分解**: 集計値を数えられる単位（1 点 = 1% / 1 人）に展開し、単位契約をサブタイトルに明記。
5. **色運用**: 淡色化したら線幅 ×1.8・不透明度床 0.85 / 1 図 3 色階未満なら灰階へ / 強調色は**唯一の主役**。
   「全データをグレー階調 + 主役 1 点だけ強調色」の wire 型は現 theme の context/accent でそのまま組める。

## フォント方針（確定事項と注意）

- 指定: 日本語 **Noto Sans JP**、英数字 **Roboto**。提示された読み込みリンクは **Roboto Condensed**
  （`family=Roboto+Condensed`）なので**リンクを正**とする（数字が細身の編集的な見た目になる。
  通常の Roboto に変える場合は family 指定 1 箇所の差し替えで済む）。
- 実装は CSS フォールバック順で実現する: `'Roboto Condensed', 'Noto Sans JP', <既存のシステム和文>` —
  英数字は Roboto Condensed が拾い、和文グリフは Noto Sans JP に落ちる。**JP を先に書くと英数字も Noto になるので順序厳守**。
- 読み込みが必要な文書は **可視化フレーム**（描画・pretext 計測・getBBox 検査が起きる場所）と app 本体（表示）。
- **書き出しの罠**: `<img>` に読んだ SVG（= `svgToCanvas` の経路）は仕様上**外部リソースを一切取得しない**。
  つまり `<link>` だけでは SVG 単体・PNG・zip の書き出しに Web フォントが乗らない → 段 4 の埋め込みで解決する。

---

## 1. 追加・変更する内容（ファイル別）

### 1.1 CSP（2 箇所。dev は CSP 非適用なので preview で実測）

- `vite.config.js`（親）:
  - `style-src` に `https://fonts.googleapis.com`
  - `font-src` に `https://fonts.gstatic.com`
  - `connect-src` に `https://fonts.googleapis.com https://fonts.gstatic.com`（段 4 の埋め込み fetch 用）
- `public/viz-frame.html`（frame 自身の CSP）:
  - `style-src 'unsafe-inline' https://fonts.googleapis.com` / `font-src data: https://fonts.gstatic.com`
  - `connect-src 'none'` は**維持**（`<link>` のスタイル・フォント取得は style-src / font-src の管轄で、connect-src に触れない）

### 1.2 フォントの読み込み（`index.html` / `public/viz-frame.html`）

提示どおりの 3 行（preconnect ×2 + css2 リンク）を両方の `<head>` に追加。
`display=swap` のままにし、読み込み失敗時はシステムフォントで描画を続ける（オフラインでも壊さない）。

### 1.3 フレームの計測整合（`public/viz-frame.js`）

- 初回 render の前に使用フォントを待つ: `document.fonts.load('700 16px "Noto Sans JP"')` 等 +
  `document.fonts.ready`、**タイムアウト 3 秒**で打ち切ってフォールバック続行。
  待たないと pretext の実測幅・getBBox 検査・入れ子余白が**フォールバック字形で測られてズレる**。
- フォント到着時に再計測はしない（直列化された次の render から効けばよい。複雑化しない）。

### 1.4 `src/viz/viz-theme.js` — タイポトークン（Lieflat 移植 + フォント切替）

```js
font: {
  family: `'Roboto Condensed', 'Noto Sans JP', system-ui, 'Hiragino Sans', 'Yu Gothic', sans-serif`,
  title: 20, subtitle: 13, axis: 11, label: 12, note: 10,   // サイズは現行維持
  weights: { title: 700, subtitle: 400, value: 800, label: 600, axis: 400, source: 500 },
  letterSpacing: { title: '-0.02em', source: '0.08em' },
}
```
- 既存キー（title 等のサイズ）は変えない（zip-template / スキル / テストが参照）。`weights` / `letterSpacing` を追加。
- 出典行の「全大文字」は和文に適用できないため採らず、**字間 +0.08em と小さめサイズ**だけ移植する。

### 1.5 スキル（workflow / charts）— Lieflat の視覚言語

1. **カードの解剖学**（workflow の模範例と charts §2 の型を書き換え）:
   タイトル `weights.title` + `letterSpacing.title` / サブタイトルは**凡例・単位・期間の契約文**
   （「1 点 = 1%・破線 = 予測・2025 年 4〜6 月」）/ 図 / **出典行**（右下 or 左下、`note` サイズ +
   `letterSpacing.source`、`mutedText`）。図内の値ラベルは `weights.value`（800）。
2. **「家具」節を charts に新設**: 疎データ（点や棒が 10 個以下）は無データの構造層に密度予算を使う —
   目盛りレール（0.5〜0.7px の発丝線）・リム目盛り・値ごとの短い tick・引出線。Plot では
   `Plot.tickX/Y`・`Plot.ruleY` の細線、d3 仕上げのレシピを最小コードで示す。
3. **単位分解レシピ**: 構成比・少数パーセントは「1 点 = 1 単位」のドットフィールド / ワッフル
   （`Plot.cell` の 10×10 か d3 の点格子）に展開し、単位契約をサブタイトルへ。丸めの欠けは底注に書く。
   円グラフ回避（MUST 6）の受け皿として §10 に追加。
4. **色運用 3 規則を配色節へ追記**: ①薄い色で細線を描くときは線幅 ×1.8・不透明度 0.85 以上
   ②1 図で使う色が 2 色以下なら色分けをやめてグレー階調 + 直接ラベル ③強調色は 1 図に**唯一の主役**だけ。
5. **wire 型（グレー + 唯一の主役）**: 「注目 1 系列 + 文脈」の場面の推奨型として、全系列 `context` グレー +
   主役だけ `accent`（または `primary`）+ 主役に直接ラベル、を最小コードで charts に追加。
6. 文字数対策: スキル合計の上限テストは 50k のまま、**増分は §12「よくある失敗」と §6 の重複刈り込みで吸収**。
   収まらない場合のみ 55k へ緩和（cache_control 前提でコストは一定だが、注意の希釈を優先して抑える）。

### 1.6 書き出しへのフォント埋め込み（`src/viz/font-embed.js` 新設）

`<img>` 経由の SVG は外部フォントを取得しないため、書き出し時だけ **data: URL の @font-face を SVG に注入**する:

1. Google Fonts の css2 を fetch し `@font-face`（`unicode-range` 付き分割チャンク）をパース（**純関数・node テスト対象**）。
2. SVG 中の使用文字集合と `unicode-range` の交差で**必要チャンクだけ**選ぶ（和文はチャンク分割されているので
   1 図あたり数個〜十数個、latin は 1〜2 個。全量埋め込みはしない）。
3. 選んだ woff2 を fetch → base64 → `<style>@font-face{...src:url(data:font/woff2;base64,...)}</style>` を
   svg 直下に注入（`svg-export.js` の整形段階）。結果はモジュール内でメモリキャッシュ。
4. 失敗（オフライン・CSP・パース不能）は**警告ログのみでフォールバック**し、書き出し自体は成功させる。
- 結線: `svg-export.js`（SVG 単体 DL）/ `png-export.js`（PNG・フィードバック PNG は任意 — サイズ増と相談し、
  まず DL 用のみ）/ `zip-export.js`（CDN 参照なし方針を維持するため、同じ CSS を `fonts.css` として同梱し
  index.html から読む。取得失敗時はシステムフォントで生成）。

### 1.7 テスト

- `test/dataviz-viz.test.js`: theme 表に `weights` / `letterSpacing` が出ること・スキル新節の見出し
- `test/reference-index.test.js`: 文字数上限（1.5-6 の方針で確認）
- `test/font-embed.test.js`（新設）: css2 パース・unicode-range 交差選択・失敗時フォールバック（fetch は注入）
- フォント適用・書き出しの見た目は node で検査できないため Playwright 実測（下の検証）

### 1.8 docs

- `CLAUDE.md`: フォント方針（family の順序と理由・frame の fonts 待ち・書き出し埋め込み）、CSP 追記、タイポトークン
- `docs/architecture.md` / `docs/extending.md` の該当箇所を同期

## 2. 実装順序

| 段 | 内容 | 確認 |
|---|---|---|
| 1 | フォント基盤（CSP ×2・link ×2・frame の fonts 待ち・theme.font.family） | preview + Chromium でフォント適用を実測（和文 = Noto / 数字 = Roboto Condensed の字形） |
| 2 | theme タイポトークン + カードの解剖学（workflow / charts の型） | `npm test`・目視 1 図 |
| 3 | charts: 家具・単位分解・色運用 3 規則・wire 型 | テスト（TOC・文字数）・lint |
| 4 | font-embed.js + svg/png/zip 結線 | 書き出した SVG / PNG / zip のフォントを目視・オフライン相当（fetch 失敗）でも書き出し成功 |
| 5 | 目視 6 図（第 2 期と同じ構成 + ドットフィールド 1 図）+ docs + build | PNG 送付・build 成功 |

## 3. 検証

- `npm run lint` / `npm test` / `npm run build`
- preview 実測: フレーム内描画・pretext 実測幅がフォント読み込み後の字形で揃うこと（終端ラベルの右余白が切れない）
- 書き出し: SVG 単体を別ブラウザ文脈で開いてフォントが乗ること / PNG の文字が Noto + Roboto Condensed であること /
  zip を file:// で開いてオフラインでも崩れないこと
- 目視 6+1 図（Plot 折れ線・積み上げ・ファセット・散布・d3 ドーナツ・地図 + ドットフィールド）
- 任意（課金あり）: 実 API キーで 2〜3 依頼を投げ、サブタイトル契約文・出典行・家具が生成コードに現れるか確認

## 4. 今回やらないこと（将来候補）

1. **紙色背景**（Lieflat の紙灰 `#F0EFEB`）: 見た目の伸び幅は大きいが、現パレットは白背景で CVD・コントラスト
   検証済み。まず本期のタイポ + 家具で効果を見てから、再検証込みで次期判断。
2. **テンプレート複写アーキテクチャ**: うちは生成型。教訓（規則より完成形）は模範 render の拡充で吸収済み。
   図種別の完成形をもう数枚増やすのは次期候補。
3. Lieflat のアニメーション・報告モード・ECharts 依存部・Inter。
4. 評価ループ（第 2 期から継続の将来候補）。

## 進捗

- **完了（2026-09-01）**: 段 1〜5 をすべて実施。
  - 段 1: index.html / viz-frame.html に preconnect + css2 リンク、CSP を親・frame の 2 箇所更新
    （frame は connect-src 'none' のまま style-src / font-src だけ許可）。frame は初回 render 前に
    `document.fonts` を最大 3 秒待つ。フレーム内で 13 面ロード・Roboto Condensed の数字幅 98.7px vs
    システム 111.2px を実測（サンドボックスのプロキシがブラウザ TLS を切るため page.route + curl 実バイトで代替）。
  - 段 2: theme.font に weights（title 700 / value 800 / label 600 / source 500）と letterSpacing を追加。
    workflow 模範例と charts §2 をカードの四点セット（結論タイトル・契約文サブタイトル・図・出典行）に更新。
    スキル本文から模範例を抽出して描画する検証方式に切替（乖離防止）。
  - 段 3: charts に家具（発丝レール・刻み・引出線）・ドットフィールド（単位分解）・色運用 3 規則・wire 型。
    §6/§12 の重複刈り込み + 上限 55k へ緩和（合計 52,450 文字）。
  - 段 4: font-embed.js（css2 パース → unicode-range × 使用文字の交差選択 → data: @font-face 注入。
    純関数部は node テスト、fetch は注入）。App の svg / png DL と zip（fonts.css 同梱・viz.svg にも注入）に結線。
    実 Google バイトで 16 face・8KB → 1.5MB、`<img>` 経路（PNG と同一）のラスタライズを確認。
  - 段 5: 目視 6+1 図（従来 6 図 + ドットフィールド。全図警告 0・新フォント適用を確認）、CLAUDE.md /
    docs/architecture.md 同期。テスト 140 件 / lint 0 / build 成功。
  - 未実施: 実 API キーでの生成確認（課金）。フォント指定は本文「Roboto」に対しリンクが Roboto Condensed
    だったため**リンクを正**とした（通常 Roboto へは css2 の family と theme.font.family の 2 箇所差し替え）。
