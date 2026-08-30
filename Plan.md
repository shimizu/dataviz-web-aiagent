# 目的

フロントエンドの AI エージェントが、ユーザーから複数の csv / tsv / geojson / geotiff を受け取って、
ユーザーと対話しながら美しく最適なデータ可視化を作成する。

作成したデータ可視化は、svg / png / zip（html, js, css, datafile）でダウンロードできるようにする。

# AI エージェント

- ユーザーと対話する（チャット or 音声）
- データを確認・分析する
- 最適な可視化方法を提案する
- 不明な点や分析にさらに必要なデータがあればユーザーに質問する
- 全てが揃ったらデータ可視化を作成してユーザーに表示する
- ダウンロードできるようにする

# ストレージ

- 受け取った csv / tsv / geojson / geotiff はフロントエンドのストレージに保存
- 作成した可視化（svg / png / zip）もストレージに保存
- 「新しい会話」のときは全て削除

# 確定済みの方針（2026-08-30）

- Claude の視覚的セルフチェック（PNG を tool_result に返す）は**入れない**。tool_result はテキストのみ。
- zip には d3 等のライブラリを**同梱**する（CDN 参照しない。オフラインで開ける）。
- データ規模は小〜中: CSV ≤ 20 万行 / GeoJSON ≤ 20MB / GeoTIFF ≤ 50MB。表示用に自動間引き。
- `reference/` の 4 本のガイドは「要約スキルを system prompt に常駐 + `read_reference` ツールで詳細節を取得」。

---

# 設計

## 1. 全体像

```
ユーザー ─ ファイル D&D ─▶ src/data/import-files.js ─▶ parsers/{tabular,geojson,geotiff} ─▶ dataset-store（メモリ優先 + IndexedDB 永続）
チャット / 音声 ─▶ Claude ─ list_datasets / describe_dataset / execute_javascript(既存) + save_dataset / read_reference
                          ─ render_visualization / update_visualization
                              └▶ src/viz/viz-frame-bridge.js ─postMessage─▶ <iframe sandbox="allow-scripts"> public/viz-frame.html
                                                                           （public/viz-runtime.js: d3+turf+geoWarp / new Function で render 実行）
                                 ◀── { ok, svg 文字列, warnings, console, stats } ──┘
                              └▶ visualization-store + postChatMessage({ kind:'viz' }) → チャットカード / 可視化タブ
ダウンロード: SVG（文字列→Blob）/ PNG（SVG data: → Image → canvas 2x）/ ZIP（fflate: index.html, viz.js, style.css, viz-runtime.js, data/*）
```

## 2. 技術方針

1. **生成コードは隔離 iframe で実行**。`public/viz-frame.html`（同一オリジンの実ファイル）を `sandbox="allow-scripts"`
   （`allow-same-origin` 無し = opaque origin。親の localStorage / API キー / DOM に到達不能）で読む。
   実ファイルの document は親の meta CSP を継承しないので、frame 自身に
   `default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'`
   を書き、`new Function` を許可しつつ外部通信を遮断。**親の `vite.config.js` の CSP は変更しない**
   （`frame-src` は `default-src 'self'` に落ちる。PNG 化は blob: でなく data: URL を使う）。
   実行前検査は既存 `src/analysis/code-guard.js` の `inspectCode` を流用。
2. **`public/viz-runtime.js`**（生成物・gitignore）: d3 + d3-geo-projection + d3-geo-polygon + @turf/turf + geoWarp（書き直し版）を
   `window.d3`（`Object.assign({}, d3, geoProjection, geoPolygon)` の順でマージ）/ `window.turf` / `window.geoWarp` に載せる IIFE 1 本。
   別設定 `vite.runtime.config.js`（`build.lib` / `formats:['iife']` / `outDir:'public'` / `emptyOutDir:false`）でビルドし、
   `predev` / `prebuild` / `build:runtime` スクリプトで生成。frame の `<script src>` と zip 同梱の両方に使う。
3. **frame 側 JS `public/viz-frame.js` は手書きの classic script**（import 不要・150 行程度なのでビルドしない。ES2020 可）。
4. **生成コードの契約**: `function render({ container, d3, turf, geoWarp, datasets, width, height, theme })` を定義し、
   `container` に `<svg>` を 1 つ作る（`viewBox` 必須）。外部 CSS・fetch・transition/アニメ不可。ラスタは canvas に描いて
   `<image href="data:image/png;base64,...">` として SVG に埋める（SVG / PNG 書き出しが一貫、blob: は opaque origin で親から読めない）。
5. **ストレージ**: IndexedDB（DB 名 `storageKey('dataviz')`、ストア `files` / `datasets` / `visualizations`。依存追加なし）。
   ストアは**メモリ優先 + IDB は永続化のみ**（既存 `execute_javascript` の `getDataset` が同期呼び出しのため）。起動時 `hydrate()`。
   localStorage は従来どおり設定・会話のみ。「新しい会話」で IDB もクリア。
6. **派生データセット**: `src/tools/javascript/handlers.js` に `deps.onAnalysisResult?.(result)`（success 時）を 1 行足し、
   dataviz 側が `codeHash` で直近 5 件の全行を保持 → `save_dataset({ name, codeHash })` で昇格。結合（CSV×GeoJSON）は render 内で `Map` 結合させる。
7. **frame 側データセットキャッシュ**: `viz:put-dataset` と `viz:render({ datasetIds })` を分離し、update のたびに 20 万行を複製しない。
8. **書き出し**: SVG = frame から返った文字列に XML 宣言を付けて Blob。PNG = `data:image/svg+xml` を `Image` → canvas（2x・白背景）→ `toBlob`。
   ZIP = `fflate`（新規依存 0.8.3、MIT、eval 不使用、`min-release-age=7` 充足）の非同期 `zip` で
   `{ index.html, viz.js, style.css, viz-runtime.js, data/datasets.js(window.__DATASETS__)、data/<name>.csv|.geojson, README.txt }`。
   `file://` で開いても動く形（fetch を使わない）。runtime は `fetch(BASE_URL + 'viz-runtime.js')` で取得（同一オリジン）。
9. **GeoTIFF**: `geotiff` を動的 import、`fromArrayBuffer → getImage → readRasters({ width, height, resampleMethod:'nearest' })` で
   長辺 ≤ 2048 に間引き。`Float32Array` バンド（最大 4）+ `{ width, height, bbox, crs, nodata, stats, geoTransform }`。
   ZSTD / JPEG / LERC 圧縮（WASM が要る）は未対応として日本語エラー。
10. **UI**: `.workspace-main` に `DatavizWorkspace`（既存 `TabbedPanel` 再利用）:「データ」（DropZone + 一覧 + プレビュー）と
    「可視化」（bridge の iframe + バージョン切替 + SVG / PNG / ZIP ボタン）。`renderMessage` で `kind:'viz'` → `VizCard`
    （`<img src="data:image/svg+xml,...">` サムネ。生成 SVG を親 DOM に inline しない）。
11. **音声**: `buildContext` / `buildSnapshot` にデータセット一覧と現在の可視化、`extraTools` に `look_at_visualization`
    （現在の可視化を JPEG base64 にして `session.sendImage` を**先に**呼び → `{ looked:true, title }`）。

## 3. ファイル構成

### 新規
```
vite.runtime.config.js                  viz-runtime を IIFE で public/ に出す
public/viz-frame.html                   隔離 iframe 本体（自前 meta CSP + viz-runtime.js + viz-frame.js）
public/viz-frame.js                     frame ブリッジ（手書き classic script）
public/viz-runtime.js                   生成物（gitignore）

src/viz-runtime/index.js                グローバル登録エントリ
src/viz-runtime/geo-warp.js             d3-geo-warp 書き直し（Float32Array 入力・nearest/bilinear・nodata・色 LUT・mask）
src/viz-runtime/raster-paint.js         ImageData バッファ書き込みの純粋部分（node --test 対象）

src/data/dataviz-db.js                  IndexedDB 薄ラッパ（open/get/put/delete/clear/getAll、indexedDB 不在ならメモリのみ）
src/data/dataset-store.js               subscribe / hydrate / get(sync) / add / remove / clear
src/data/visualization-store.js         同上（versions 配列 + current）
src/data/file-store.js                  原本（ArrayBuffer/テキスト + メタ）
src/data/import-files.js                File[] → 判定 → parsers → ストア（サイズ上限検査もここ）
src/data/parsers/{tabular,geojson,geotiff}.js
src/data/dataset-shapes.js              正規化形・toRuntimeDataset()・describeDataset()（純関数）

src/viz/frame-protocol.js               メッセージ種別・既定サイズ・タイムアウト定数
src/viz/viz-frame-bridge.js             createVizFrameBridge({ src, createElement, setTimeoutFn, timeoutMs }) → { element, ready, putDataset, render, clear, dispose }
src/viz/viz-theme.js                    theme トークン（ガイド §18 / §28 を統合。決定的）
src/viz/{svg-export,png-export,zip-export,zip-template,download}.js

src/tools/dataviz/index.js              { id:'dataviz', skills:[5 本], register }
src/tools/dataviz/definitions.js
src/tools/dataviz/{dataset,visualization,reference}-handlers.js
src/tools/dataviz/reference-loader.js   topic → dynamic import('reference/*.md?raw')（初期チャンクに入れない）
src/tools/dataviz/reference-index.js    見出し分割・検索・切り詰め（純関数）

src/agent/skills/dataviz-{workflow,charts,maps,geojson,raster}.js

src/hooks/useDatavizStores.js           useSyncExternalStore でストアを購読
src/components/dataviz/{DatavizWorkspace,DropZone,DatasetList,DatasetPreview,VizPanel,VizCard}.jsx

test/{dataviz-parsers,dataviz-describe,dataviz-tools,reference-index,dataviz-skills,viz-frame-bridge,zip-export,geo-warp}.test.js
```

### 変更
| ファイル | 変更 |
|---|---|
| `src/App.jsx` | `agentDeps`（stores / bridge / `getDataset` / `onAnalysisResult` / `onVisualizationShown`。すべてモジュールスコープ or ref 経由で参照安定）、`contextParts`、`voiceExtraTools`、`buildContext` / `buildSnapshot`、`renderMessage`、`.workspace-main`、`handleNewConversation` に全ストア + bridge クリア、起動時 `hydrate()` |
| `src/tools/sources.js` | `datavizSource` 追加（`exampleSource` / `javascriptSource` は残す） |
| `src/tools/javascript/handlers.js` / `register-tools.js` | `deps.onAnalysisResult` フック + コメント |
| `package.json` | `fflate`、`build:runtime` / `predev` / `prebuild` |
| `.gitignore` / `eslint.config.js` | `public/viz-runtime.js` 無視。`public/viz-frame.js` は `sourceType:'script'` + globals（d3, turf, geoWarp） |
| `src/components/ChatPanel.jsx` | 「新しい会話」の confirm 文言に「データと可視化も消える」 |
| `AgentHelpModal.jsx` / `AboutModal.jsx` / `Header` title / `app.css` | ドメイン文言・パネルのスタイル |
| `CLAUDE.md` / `README.md` / `docs/architecture.md` / `docs/extending.md` | 構成・IndexedDB・frame の CSP・runtime ビルド手順 |
| `reference/`, `Plan.md` | コミット対象にする（`?raw` import で参照するため） |
| `AGENTS.md` | 削除のまま（`CLAUDE.md` / `docs/` の `AGENTS.md` への参照を消す） |

## 4. データセットの形

### 保存形（dataset-store）
```js
共通: { id:'ds_001', name, kind:'tabular'|'geojson'|'raster', sourceFileId, createdAt, derivedFrom:null|{ datasetIds, codeHash }, byteSize }
tabular: { columns:[{ name, type:'number'|'string'|'date'|'boolean', nullCount, uniqueCount, min, max, examples }], records:[{...}], rowCount }
geojson: { featureCollection, displayFeatureCollection:null|FC（総頂点 > 30 万のときだけ turf.simplify）, featureCount, geometryTypes, bbox,
           propertiesSchema:[列と同形], diagnostics:['[lat,lon] の疑い','投影座標','リング方向が逆','NaN 座標 n 件','日付変更線跨ぎ'] }
raster:  { width, height, originalWidth, originalHeight, bbox, crs:'EPSG:4326'|'EPSG:3857'|'unknown', nodata, bandCount, bands:[Float32Array], stats:[{min,max,mean,validCount}], geoTransform }
```
ID は既存 `src/utils/ids.js` の連番（`ds_001` / `viz_001`）。

### Runtime 形（Worker と frame に共通、`toRuntimeDataset(ds)`）
```js
{ id, name, kind, columns:[{name,type}], records:[行 | features | []],
  metadata:{ rowCount|featureCount, bbox, geometryTypes, crs, nodata, stats, geoTransform, width, height, diagnostics, geojson, raster },
  geojson: FC|null, raster:{ width, height, bbox, nodata, bands }|null }
```
既存 `analysis-runner.toWorkerDataset` は `records / columns / metadata` しか拾わないので `metadata` にも `geojson` / `raster` を入れる
（スキルに「Worker では `metadata.geojson`、render では `datasets[id].geojson`」と明記）。

## 5. ツール（1 ソース `dataviz`）

| ツール | input | 戻り値（要約のみ・8000 字以内に自前で切り詰め） |
|---|---|---|
| `list_datasets` | `{}` | `[{ id, name, kind, rowCount|featureCount|size, columns(先頭 30 列名), derivedFrom }]` |
| `describe_dataset` | `{ id, sample?(0–20, 既定 5), stats?(既定 true) }` | tabular: 列統計 + サンプル行 / geojson: 件数・型・bbox・propertiesSchema・サンプル properties・**diagnostics** / raster: サイズ・bbox・crs・nodata・バンド統計 |
| `save_dataset` | `{ name, codeHash }` | `{ id, name, rowCount, columns }`。直近の `execute_javascript` 結果が無ければ「先に execute_javascript」エラー |
| `render_visualization` | `{ title, code, datasetIds[], width?(320–4096, 既定 960), height?(既定 600), description? }` | `{ vizId, version:1, ok, stats:{elementCount,textCount,imageCount,svgBytes,durationMs}, warnings, console(末尾 10), note:'可視化タブに表示済み' }`。失敗は throw（message + console 末尾 + stack 先頭 3 行）→ `is_error` |
| `update_visualization` | `{ vizId, code, title?, width?, height?, changeNote? }` | 同上（`version:n+1`。旧バージョン保持） |
| `read_reference` | `{ topic:'dataviz'|'maps'|'geojson'|'raster', section?('6.3' or 見出し一部), maxChars?(既定 7000) }` | section 省略: 目次 `[{number,title,level}]` / 指定: `{ number, heading, text, truncated, siblings }` |

`render_visualization` の流れ: `inspectCode` → datasetIds 解決 → 未送信 dataset を `bridge.putDataset` → `bridge.render` →
`visualization-store.add` → `postChatMessage({ kind:'viz', vizId, version, title })` → `onVisualizationShown(vizId)` → 要約返却。
warnings があっても `ok:true` なら成功（Claude が warnings を読んで直すか判断）。

## 6. iframe ブリッジ

| 向き | type | payload |
|---|---|---|
| frame→親 | `viz:ready` | `{ runtimeVersion }`（load 時・リロード後） |
| 親→frame | `viz:put-dataset` | `{ dataset }`（frame の Map にキャッシュ） |
| 親→frame | `viz:render` | `{ requestId, code, datasetIds, width, height, theme }` |
| frame→親 | `viz:result` | `{ requestId, ok, svg, warnings, console, error, stats }` |
| 親→frame | `viz:clear` | キャッシュと DOM をクリア |

- 受信検証: 親は `event.source === iframe.contentWindow`、frame は `event.source === window.parent`。送信は `'*'`（opaque origin は名指し不可）。
- `message` リスナーを先に登録してから `iframe.src` を設定。ready 10 秒 / render 20 秒でタイムアウト。render は直列キュー。
- **タイムアウト時は `iframe.src` を再設定してリロード**（暴走コードの唯一の止め方）。`loadedIds` をリセットし再 ready を待ってから reject。
- frame 側: container を空に → `new Function('"use strict";\n' + code + '\nreturn typeof render === "function" ? render : undefined')` →
  `await render(...)` → `svg` 取得 → `xmlns` / `width` / `height` / `viewBox` 補完 → `XMLSerializer` → 統計・警告 → `viz:result`。
- エラー収集: try/catch + `window.onerror` + `unhandledrejection`。console は差し替えで最大 50 件 × 500 字。
- warnings: svg 無し / 空 / 要素数 > 20,000 / 属性に `NaN`・`undefined` / `<foreignObject>` / `href="http` / `blob:` / サイズ不一致 / 埋め込み画像 10MB 超。
- テスト: 偽 iframe（`contentWindow.postMessage` を記録し `onmessage` を呼べる）+ `setTimeoutFn` 注入で ready / requestId / タイムアウト→リロードを検証。

## 7. スキル（`src/agent/skills/dataviz-*.js`、各 100〜200 行、決定的・手書き）

`dataviz-workflow.js`: 手順 **1. 確認**（`list_datasets` → `describe_dataset`、diagnostics と列型を必ず読む）→ **2. 提案と質問**
（伝えたいこと・図の種類・エンコーディング・投影法を 2〜4 行で提案。不明点〔比較対象・期間・単位・結合キー・色の意味・追加データ〕が
あれば**ツールを呼ばず質問で終える**。1 度に 3 つまで・選択肢付き。runtime 側の変更は不要: end_turn で完了扱い）→ **3. 描画**
（必要なら `execute_javascript` → `save_dataset`、`read_reference`）→ **4. 確認**（何を描いたか・読み取れること・変えられる点を 3 行。修正は `update_visualization`）
→ **5. ダウンロード案内**（可視化タブのボタン。ツールは無い）。render 契約・datasets の形・theme 表・エラーの直し方もここ。

要約の残し方（各末尾に `read_reference` 用の目次表。`test/dataviz-skills.test.js` が `reference/*.md` の章番号・見出しと一致することを検証）:

| topic | 残す | 落とす |
|---|---|---|
| charts | §1 12 原則、§3〜8（決めること・余白・文字・軸・色・ラベル）、§9〜11 の要点、§16 SVG/Canvas、§17 join/レイヤ、§20 NG、§21 チェックリスト | §12〜15（「title を付ける」「アニメ不可」の 2 行のみ）、§19 実装例、§22 参考 |
| maps | §1 15 原則、§4 投影法の決定表（+ d3-geo-projection / polygon の使い分けを自前で補足）、§5 fitExtent、§6 レイヤ順、§8 境界、§10〜16、§18、§29 NG、§30 | §9 mapshaper、§19〜27、§31 |
| geojson | §2 問題一覧、§3〜12 各「症状→確認→turf 修正」、§13 正規化関数短縮版、§14 無条件禁止、§15 安全、§16 診断フロー（describe の diagnostics と対応） | §1、§17 詳細、§19〜21 |
| raster | §2〜5 モデル・geoTransform・output-driven、§7〜13、§16〜18 isolines、§34〜36 凡例・hillshade、§43〜44、§52、§66、**本アプリの geoWarp API** | §21〜33（1 行）、§45〜51、§54〜65、§67〜69 |

`read_reference`: `reference-index.js` が `^#{1,3}\s+(\d+(\.\d+)?)\.?\s+(.+)$` で番号付き見出しに分割（ガイドは `#` / `##` が混在）。
番号完全一致 → 見出し部分一致（複数ならリスト）。

## 8. 実装順序

| 段 | 内容 | 確認 |
|---|---|---|
| **M1 実行基盤** | `vite.runtime.config.js`、`src/viz-runtime/*`、`public/viz-frame.{html,js}`、`src/viz/{frame-protocol,viz-frame-bridge,viz-theme}.js`、scripts / gitignore / eslint | `npm run build:runtime` で生成。`npm run build && npm run preview` で仮ボタンから棒グラフを render し `viz:result` が返る。**opaque origin で frame の CSP `'self'` が効くことを DevTools で実測**（効かなければ runtime ソースを postMessage で渡し `new Function` で評価する代替）。bridge / geo-warp テスト緑 |
| **M2 データ層** | `src/data/*`、`parsers/*`、`useDatavizStores`、データタブ UI、`getDataset` 注入、`list/describe/save_dataset`、`onAnalysisResult`、`dataviz-workflow.js` 骨子 | 4 形式をドロップ → 一覧・プレビュー → リロード後も残る → 「データを説明して」で describe。`execute_javascript` → `save_dataset`。parsers / describe テスト |
| **M3 可視化ツール** | `visualization-store`、`render/update_visualization`、`VizPanel` / `VizCard` / `renderMessage`、`dataviz-charts.js` | 「推移を折れ線で」→ カードとタブ → 「色を変えて」→ v2。壊れたコードで `is_error` → 自己修正。tools テスト（偽 bridge・偽 store） |
| **M4 書き出し** | `fflate`、`svg/png/zip-export`、`download`、DL ボタン | 3 形式を保存。zip を展開し `file://` で同じ図。PNG にラスタが写る。zip-export テスト |
| **M5 リファレンス・残りスキル・文言** | `read_reference` 一式、`dataviz-{maps,geojson,raster}.js`、`AgentHelpModal` / `AboutModal` / Header、docs | コロプレスとラスタ（geoWarp）の依頼が通る。reference-index / skills 目次テスト。`npm run lint` 警告 0 |
| **M6 音声・仕上げ** | `buildContext` / `buildSnapshot` / `look_at_visualization`、「新しい会話」の全消去、CSP 最終確認 | 音声で「このグラフを見て」→ 画像送信後に応答。「新しい会話」で IDB が空。preview で CSP 違反ゼロ |

### 進捗
- **M4 完了（2026-08-30）**: `fflate` 追加 / `src/viz/{svg-export,png-export,zip-export,zip-template,download}.js` / App の DL 結線 / `test/viz-export.test.js`（計 117 件）。
  Chromium で実測: SVG（XML 宣言・xmlns・背景つき 3.8KB）/ PNG（2 倍解像度 1440×840）/ ZIP（284KB）をダウンロードし、
  zip を展開して **`file://` で開いて同じ図が描画されることを確認**（d3・turf・データ 6 行が復元、canvas 由来の `<image>` も残る）。
  zip の中身: `index.html` / `viz.js` / `style.css` / `viz-runtime.js` / `data/datasets.js` / `data/<元ファイル>` / `viz.svg` / `README.txt`。
  ダウンロード（`URL.createObjectURL` + `<a download>`）は本番 CSP でも動く。
- **M3 完了（2026-08-30）**: `src/data/visualization-store.js` / `src/tools/dataviz/visualization-handlers.js`（render / update）/
  `src/agent/skills/dataviz-workflow.js`（render 契約・雛形・theme 表を追加）/ `src/agent/skills/dataviz-charts.js`（チャート作法の要約）/
  `src/components/dataviz/{VizPanel,VizCard}.jsx` / DatavizWorkspace のタブ制御（iframe を常時マウント、非表示は画面外退避）/ App 結線 / テスト（105 件）。
  Claude API を Playwright の `page.route` でモックした E2E（本番ビルド）で実測: list → describe → render（折れ線）→ カード投稿 →
  可視化タブへ自動切替 → update（横棒 v2）→ バージョン切替で v1 を再描画 → IndexedDB に 2 バージョン保存 → system の揮発ブロックに一覧同梱。
  **モック E2E の作法**: `scratchpad/check-viz.cjs`（`page.route('https://api.anthropic.com/v1/messages')` で tool_use を順に返す）。
- **M2 完了（2026-08-30）**: `src/data/{dataviz-db,record-store,dataset-store,file-store,analysis-cache,import-files,dataset-shapes}.js` /
  `src/data/parsers/{tabular,geojson,geotiff}.js` / `src/hooks/useDatavizStores.js` / `src/components/dataviz/{DatavizWorkspace,DropZone,DatasetList,DatasetPreview}.jsx` /
  `src/tools/dataviz/{index,definitions,dataset-handlers}.js` / `src/agent/skills/dataviz-workflow.js` / App.jsx 結線 / テスト 2 本（96 件）。
  Chromium で実測: csv・tsv・geojson の取り込み → 一覧・型推定・プレビュー・GeoJSON 診断 → IndexedDB 永続 →
  リロード復元 → 「新しい会話」で全消去まで動作。
  **本番 CSP で判明した重要事項**: `d3-dsv` の `parse()` は行オブジェクト生成に `new Function` を使うため
  `script-src 'self'` で失敗する（dev では CSP 非適用のため露見しない）。`parseRows()` を使うこと。
  同様に**メインスレッドで動くライブラリが内部で `new Function` / `eval` を使っていないか、`npm run preview` で必ず確認する**。
- **M1 完了（2026-08-30）**: `vite.runtime.config.js` / `src/viz-runtime/{index,geo-warp,raster-paint}.js` / `public/viz-frame.{html,js}` /
  `src/viz/{frame-protocol,viz-frame-bridge,viz-theme}.js` / `test/{geo-warp,viz-frame-bridge}.test.js`。
  `npm run build && vite preview` + Chromium で実測済み: opaque origin の frame で CSP `'self'` により `viz-runtime.js` が読めて
  `new Function` が動く。`connect-src 'none'` で fetch / WebSocket / 外部画像が遮断、`localStorage` と `parent.document` は SecurityError。
  geoWarp の canvas → data URL 埋め込みも動作。**代替案（runtime ソースの postMessage 注入）は不要**。

## 9. リスクと注意点

1. **frame の CSP `'self'` と opaque origin** — CSP3 は self-origin をレスポンス URL から取るので動く想定。M1 で実測、代替あり。
2. **Vite 8（rolldown）の lib IIFE** — 型上サポート。d3 の ESM を束ねた出力名を実測。問題があれば `umd`。
3. **structured clone のサイズ** — frame キャッシュで再送回避。GeoTIFF は長辺 2048 × 最大 4 バンド。
4. **geotiff の ZSTD/JPEG/LERC** — WASM が要るので未対応エラー（将来 `'wasm-unsafe-eval'`）。
5. **暴走コード** — iframe は terminate できないので reload で回復。reload 中の render はキューで待つ。
6. **tool_result 8000 字** — describe / read_reference / console は自前で切り詰め `truncated` を明示。
7. **スキルサイズ** — 5 本で ~700 行（~20k トークン）。安定プレフィックスでキャッシュ。まず各 100 行前後から。
8. **XSS** — 生成 SVG を親 DOM に inline しない（`<img src=data:>`）。frame は sandbox。
9. **hydrate 前の `getDataset`** — null → 「読み込み中」エラー。App は `hydrate()` 完了までチャットを無効化。
10. `predev` は `npm run dev` 経由でのみ走る（README に明記）。`reference/` は `?raw` 参照のためコミット必須。

## 10. 検証

- `npm run lint`（警告 0）/ `npm test`（新規 8 本）
- `npm run dev` で手動: CSV / TSV / GeoJSON / GeoTIFF を D&D → describe → 質問 → render → update → SVG / PNG / ZIP → zip を `file://` で開く
- `npm run build && npm run preview` で CSP 下の動作（frame の `new Function`、`connect-src 'none'`、親の CSP 無変更）
- 「新しい会話」で IndexedDB の 3 ストアが空（DevTools Application タブ）
- 音声: `look_at_visualization` が画像 → 応答の順で動く
