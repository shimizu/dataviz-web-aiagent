# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**データ可視化エージェント**。ユーザーが csv / tsv / geojson / geotiff をドロップし、チャットか音声で相談しながら
**Claude が D3 の描画コードを書いて図を作る**。図は隔離 iframe で実行して SVG に落とし、SVG / PNG / ZIP（html + js + css + データ）で
ダウンロードできる。骨格は voice-agent-shell（音声 Gemini Live × ツール実行 Claude のブラウザ完結型シェル）で、
バックエンドを持たず、API キーは localStorage、データと可視化は IndexedDB に保存する。

## コマンド

```bash
npm install        # 依存インストール（Node 20+。~/.npmrc の min-release-age に注意）
npm run dev        # Vite 開発サーバー（http://localhost:5173）。predev で viz-runtime を生成
npm run build      # 本番ビルド（dist/）。CSP meta を注入する。prebuild で viz-runtime を生成
npm run build:runtime  # public/viz-runtime.js（d3 + geo-projection + geo-polygon + Plot + turf + geoWarp + pretext の IIFE）だけ作る
npm run preview    # ビルド結果のプレビュー
npm run lint       # ESLint（--max-warnings 0）
npm test           # node --test（ブラウザ非依存の純ロジックのみ）
npm run deploy     # gh-pages で dist/ を公開（predeploy で build。vite.config.js の base:'./' 前提）
node --test test/runtime.test.js   # 単一テストファイルの実行
```

ESLint は `dist/`・`public/viz-runtime.js`（生成物）・`reference/`（参照資料）を無視する。

テストは Node 標準の `node --test`。ブラウザ依存（WebAudio / DOM / WebSocket / IndexedDB）に触れない純ロジックだけを対象にする
（シェル由来: runtime / tool-registry / claude-client / compaction / system-prompt+system-context / voice-* / gemini-* /
example-tools / analysis-runner / javascript-tools。可視化: geo-warp〔raster-paint〕/ viz-frame-bridge〔偽 iframe・偽タイマー〕/
dataviz-parsers / dataviz-tools / dataviz-viz〔偽 bridge〕/ viz-export〔zip の展開まで〕/ reference-index〔実ガイドの分割と目次一致〕）。
描画・音声・CSP は `npm run build && npm run preview` を Chromium（Playwright）で叩いて確認する。
**Claude API は Playwright の `page.route('https://api.anthropic.com/v1/messages')` で tool_use を順に返すモックにできる**
（キー不要で取り込み → render → update → 書き出しまで E2E が回る。`~/.claude/debug.md` の手順）。

## アーキテクチャ

### レイヤ分離（最重要）
`src/components/` は**表示と入力のみ**。推論・ツール実行は `src/agent/`・`src/tools/`・`src/voice/` のプレーン JS が行う。
**コンポーネントに API 呼び出しを直書きしない。** `src/App.jsx` が唯一の結線点で、`src/hooks/` の結線フックを依存順に組み立てる。
`src/agent/` と `src/voice/` は `src/tools/` を import しない（結線は `useAgentSession`）。

### 2 系統 LLM の役割分担
- **Claude**（`agent/`）= 実作業。ツール定義とスキルを持ち、tool use ループで `is_error` を見て自己修正する。
- **Gemini Live**（`voice/`）= 会話。**ドメインのツールは渡さない**。渡すのは `run_prompt`（入力欄に書いて**送信まで行う**）と、
  アプリが `extraTools` で注入した関数だけ。Claude 実行中の `run_prompt` は busy で拒否。
- 橋渡しは App の `agentFinishedRef`: `useAgentSession.onFinished` → `useVoiceSession.notifyAgentFinished` → `sendText`（読み上げ）。
  会話中の状態変化は `sendText` で伝えず、ツール応答に `buildSnapshot()` を同梱する。Claude 完了だけは `sendText`。

### 結線フック層（`src/hooks/`）
- `useSettings` — Claude キー・モデル・max_tokens / Gemini キー・Live モデル・声・検索トグル。localStorage と接続テスト。
- `useAgentSession({ deps, buildSystem, apiKey, model, maxTokens, log, onFinished })` — チャット状態と `ConversationStore`、
  `runAgent` への `callClaude` / `toolRegistry` / system の注入。`deps` はツールソースへそのまま渡す（**参照安定**が必要:
  registry を `deps` でメモ化している）。`buildSystem()` は毎ターンの system ブロック（省略時は BASE+スキルのみ）。
  ツールからの `postChatMessage({ kind, ... })` もここで受ける。`onFinished({ status, content })`。
- `useVoiceSession({ apiKey, model, isAgentRunning, runPrompt, setChatInput, enableSearch, voiceName, buildContext, buildSnapshot, extraTools, log })`
  — マイク → Gemini → 再生の往復。`buildContext(): string` は接続時の指示文に入れる状況、`buildSnapshot(): object` はツール応答へ同梱。
  `extraTools: [{ declaration, handler(args, { session, log }) }]`。**画像を見せるときは handler 内で `session.sendImage()` を先に呼び、
  その後で応答を返す**（逆だとモデルが画像を見ずに話す）。戻り値には snapshot が後からマージされる（`claude_running` と衝突するキーを返さない）。
  状況系は ref で読むので、props の同一性で `start` は作り直されない。
- `useVisualViewport` — `visualViewport` の高さ/上端を追跡し、App が `.app-shell`（`position: fixed`）のインライン高さに適用する。
  スマホの 100vh/100dvh の揺れ対策。API が無い環境は CSS の dvh に委ねる。

### エージェント層（`src/agent/`）
`runtime.js`（tool use ループ、`is_error` で自己修正、`TOOL_RESULT_CHAR_CAP`。ツール結果の `_image` は画像付き tool_result になり、
終了時に `stripToolResultImages` で画像をテキストへ畳んで localStorage 永続化を守る）、`claude-client.js`（直叩き・リトライ・プロンプトキャッシュ）、
`tool-registry.js`、`compaction.js`（古い tool_result をプレースホルダに）、`conversation-store.js`（`storageKey` 注入可）、
`system-prompt.js`（`composeSystemPrompt({ base, skills })`。`tools/` を import しない）、
`system-context.js`（`buildSystemBlocks({ systemPrompt, contextParts, now })`: 安定プレフィックス〔cache_control〕+ 揮発ブロック
〔現在日時 + contextParts〕の 2 ブロック）、`skills/`（1 ドメイン 1 ファイルの Markdown 文字列）。
**スキル文字列は決定的にする**（現在月などの揮発情報を入れない。`cache_control` 付き安定プレフィックスに載るため。
現在日時は `system-context.js` の揮発ブロックで渡す）。

### 音声層（`src/voice/`）— Gemini Live API
- `gemini-live-client.js` — `@google/genai` の `live.connect` を包む唯一の場所（`useVoiceSession` から動的 import）。
  `connectGeminiLive({ ..., tools })` / `buildLiveTools({ enableSearch, tools })`。`sendAudio / sendImage / sendText / sendToolResponses`。
- `voice-tools.js` — `RUN_PROMPT_DECLARATION` と `buildVoiceTools(extraDeclarations)`、`dispatchToolCall`（逐次。例外は `{ ok:false, error }`）。
- `voice-instruction.js` — `BASE_VOICE_INSTRUCTION`、`buildVoiceInstruction({ enableSearch, context, base, now })`、
  `buildContextSnapshot({ isAgentRunning, snapshot })`、`buildCompletionNotice({ status, content, extras })`（純関数・テスト対象）。
- `voice-options.js` — モデル名・声の定数。`@google/genai` に依存しない（UI から読んでも初期チャンクに genai が入らないようにする分離）。
  `data/settings.js` はここから `DEFAULT_VOICE_MODEL / DEFAULT_VOICE_NAME` を re-export する。
- `audio-capture.js`（16kHz AudioWorklet → PCM16 base64）/ `audio-player.js`（24kHz PCM 再生キュー、割り込みで flush）/ `pcm.js`（純関数）/
  `pcm-worklet.js`（`new URL(..., import.meta.url)` で同一オリジンの実ファイルとして addModule。worklet のモジュール取得は script-src の
  対象なので blob:/data: は CSP で弾かれる。vite.config.js の `assetsInlineLimit` でこのファイルだけインライン化を無効化している）。
- `gemini-test.js` — 接続テスト（`GET /v1beta/models`、課金なし）。
- Google 検索グラウンディング（設定のトグル、既定 OFF・別課金）: `buildLiveTools({ enableSearch })` で `{googleSearch:{}}` を関数宣言と併用。
  `groundingMetadata` は `describeGrounding` でログに残す。検索は指示文の具体化にだけ使い、数値根拠は Claude の結果。
- CSP: `connect-src` に `https://generativelanguage.googleapis.com` と `wss://generativelanguage.googleapis.com`。

### ツール層（`src/tools/`）— 拡張ポイント
各ソースは `src/tools/<source>/index.js` で `{ id, skills: [Markdown...], register(registry, deps) }` を export し、
`src/tools/sources.js` の `SOURCES` に 1 行足すだけでツール登録とシステムプロンプトの両方に反映される。
deps の形は `src/tools/register-tools.js` 先頭のコメント参照（`{ postChatMessage, session, log, ...アプリ固有 }`。シェルは中身を見ない）。
**ツールは要約だけを LLM に返す**（行データ・地物はアプリ側のストアへ）。例外はそのまま投げる。
- `dataviz/`（本アプリの本体）: `list_datasets` / `describe_dataset` / `save_dataset`（`dataset-handlers.js`）、
  `render_visualization` / `update_visualization`（`visualization-handlers.js`: `inspectCode` → bridge へデータセット送信 → 描画 → ストア保存 →
  `postChatMessage({ kind:'viz' })`。成功時は deps の `snapshotSvg` で PNG を撮り `_image` として返し、Claude が自分の図を見て
  自己批評 → update する（workflow スキルの MUST 10。スナップショット失敗は描画成功のまま）。失敗はエラー + スタック 3 行 + console を 1 メッセージにして `is_error`）、
  `read_reference`（`reference-handlers.js` + `reference-index.js`: `reference/*.md` を `?raw` の動的 import で読み、番号付き見出しで分割）。
  スキルは `agent/skills/dataviz-{workflow,charts,maps,geojson,raster}.js`（ガイドの要約 + `read_reference` 用の目次。
  目次はテストが実ファイルと突き合わせる）。各スキルは「守る規則（MUST）→ 本文 → よくある事故と修正 → 目次」の順。
  **実際の描画事故を見つけたら該当スキルの「よくある事故と修正」に ❌/✅ で追記する**（決定的な文字列のまま）。
- `example/`: `get_current_time` / `calculate`（`arithmetic.js` = 再帰下降パーサ。`eval` 不使用なので CSP に `'unsafe-eval'` 不要）。
- `javascript/`: `execute_javascript`（生成 JS を隔離 Worker で実行。実行基盤は `src/analysis/`）。
  `deps.getDataset(id)` が注入されていれば `datasetId` / `datasetIds` を公開し、無ければ `args` だけのサンドボックスになる
  （定義自体を `buildJavascriptToolDefinition({ hasDatasets })` で切り替える）。
ドメイン知識を足すときは「純データ（JS モジュール）→ スキルの表を生成 + 小ツール」の形にする。

### 分析実行層（`src/analysis/`）— 生成 JS の隔離実行
`code-guard.js`（実行前の禁止トークン検査 + `hashCode`。**文字列検査は誤操作の早期検出にすぎない**）、
`analysis-worker.js`（使い捨て Worker 本体。`lockdown(self)` で fetch / XHR / WebSocket / indexedDB / importScripts 等を
undefined 化し、`new Function` で `analyze` を取り出して呼ぶ）、`analysis-runner.js`（検査 → 入力上限 → Worker 生成 →
タイムアウト → **必ず terminate** → 出力の JSON 互換性とサイズ検証。例外を投げず `status: success|rejected|timeout|error` で返す）。
既定値は 5 秒 / 入力 200,000 件 / 出力 1MB。ドメインに依存せず、dataset の中身は解釈せずに Worker へ渡すだけ。
Worker へ API キー・DOM・localStorage は渡さない。

### データ層（`src/data/`）
- `settings.js` — `STORAGE_PREFIX = 'voice-agent-shell.'` と `storageKey(name)` が localStorage キーの単一情報源。
- `dataviz-db.js` — IndexedDB（DB 名 `storageKey('dataviz')`、ストア `files` / `datasets` / `visualizations`）。使えない環境では黙ってメモリのみ。
- `record-store.js` — **メモリ優先 + IDB は永続化のみ**の共通ストア（`subscribe / getSnapshot / hydrate / get(同期) / add / update / remove / clear`）。
  `get` が同期なのは `execute_javascript` の `deps.getDataset` が同期呼び出しのため。起動時に App が `hydrate()`、完了までチャットは無効。
- `dataset-store.js` / `file-store.js` / `visualization-store.js` — 種別ごとの包み。モジュールスコープの単一インスタンスを App と `agentDeps` が共有する（参照安定）。
- `dataset-shapes.js` — 保存形 → `toRuntimeDataset()`（Worker / 可視化フレームへ渡す共通形。`metadata` にも geojson / raster 本体を入れる）/
  `describeDataset()` / `summarizeDataset()` / `formatDatasetList()`（揮発ブロック用）。純関数。
- `parsers/tabular.js`（**`d3-dsv` は `parse()` でなく `parseRows()`**。`parse()` は `new Function` を使い本番 CSP で落ちる）/
  `parsers/geojson.js`（診断のみ。座標は自動修正しない）/ `parsers/geotiff.js`（長辺 2048 に間引き。ZSTD / LERC / JPEG は未対応エラー）。
- `import-files.js` — File[] → 判定 → パース → ストア。上限は CSV 20 万行 / GeoJSON 20MB / GeoTIFF 50MB。
- `analysis-cache.js` — `execute_javascript` の全行を直近 5 件保持し、`save_dataset({ codeHash })` で派生データセットに昇格。

### 可視化層（`src/viz/`・`src/viz-runtime/`・`public/`）
- 生成コードは **`public/viz-frame.html` を `sandbox="allow-scripts"`（opaque origin）の iframe** で実行する。実ファイルの document は
  親の meta CSP を継承しないので、frame 自身の CSP（`script-src 'self' 'unsafe-eval'; connect-src 'none'` 等）で `new Function` を
  許可しつつ外部通信・親の localStorage / DOM を遮断する。**親の `vite.config.js` の CSP は変更しない**（Chromium で実測済み）。
- `public/viz-runtime.js` は `vite.runtime.config.js` で作る生成物（gitignore）。frame の `<script src>` と zip 同梱で共用。
- `public/viz-frame.js`（手書き classic script）: データセットを Map にキャッシュ、`render({ container, d3, Plot, turf, geoWarp, pretext, datasets, width, height, theme })`
  を呼び、`<svg>` を正規化して文字列と警告・console を返す。メッセージ種別は `src/viz/frame-protocol.js` の写し（テストが突き合わせる）。
  **基本チャートは Plot（Observable Plot）で組む**（タイトル・凡例は外側 svg + Plot の svg を入れ子。Plot の `title` / `legend` は
  `<figure>` を作り単一 svg 契約を壊すのでフレームがエラーにする）。入れ子 svg は Plot 内蔵 CSS（height:auto 等）が属性を
  上書きして内容がずれるため、width / height 属性をインラインスタイルへ焼き込んで補正する（zip の起動コードも同じ補正）。
  警告にはデザイン検査（ラベルの重なり・端切れ・9px 未満・塗り色相 > 8・近白塗り）を含む。
- `src/viz/viz-frame-bridge.js`: ready ハンドシェイク・描画の直列化・タイムアウト時は iframe をリロードして復旧・送信済みデータセットの記録。
  **iframe は DOM から外すと再読み込み、`display:none` はレイアウト値を壊す**ので、可視化タブが非表示のときは画面外へ退避する。
- `src/viz/viz-theme.js`（デザイントークン。スキルの表もここから生成）/ `svg-export.js` / `png-export.js`（data: URL → canvas 2x。blob: を使わない）/
  `zip-template.js` + `zip-export.js`（fflate。`file://` で開ける classic script 構成、CDN 参照なし）/ `download.js`。
- `src/viz-runtime/geo-warp.js`: ラスタを d3 投影へ逆引き再投影（`raster-paint.js` が純関数部分）。

### App.jsx のドメイン注入点（本アプリでの実体）
`agentDeps` = `{ datasetStore, visualizationStore, vizBridge, getDataset, onAnalysisResult, getAnalysisResult, onVisualizationShown }`
（すべてモジュールスコープ or ref 由来で参照安定）/ `buildSystem` の `contextParts` = `formatDatasetList(datasets)` /
`renderMessage` = `kind:'viz'` → `VizCard` / `.workspace-main` = `DatavizWorkspace`（データ / 可視化タブ）/ 「新しい会話」で全ストア + bridge をクリア。

## コードスタイル
プレーン JS/JSX（TypeScript なし）、2 スペース、セミコロン無し、シングルクォート。コンポーネントは `PascalCase.jsx`、
モジュールは `kebab-case.js`。各モジュール先頭に「役割 / 関係 / 流用元」のヘッダーコメントを置く。UI 文言・コメントは日本語。

## 守るべき前提
- `login`/マイク開始などブラウザの権限が絡む処理はクリックハンドラから同期的に開始する。
- `useAgentSession` の `deps` は参照安定にする（変わると registry と `handleSubmit` が作り直される）。
- 音声の extraTools で画像を送るなら「画像 → ツール応答」の順。
- CSP（vite.config.js）: 外部ホストを増やしたら `connect-src` / `img-src` を更新（dev は CSP 非適用で本番だけ壊れる）。
  `execute_javascript` の `new Function` は **Worker のグローバルスコープ**で動き、document の meta CSP は Worker に継承されない
  （同一オリジンの実ファイルとして読むため）。したがって `script-src` は `'self'` のままでよい（Chromium で実測済み）。
  メインスレッド側で `new Function` / `eval` を使うなら `'unsafe-eval'` が要る。
  **ライブラリが内部で `new Function` を使うことがある**（例: `d3-dsv` の `parse()`。`parseRows()` なら安全）。
  dev では CSP が効かないので、外部ライブラリを足したら `npm run preview` で必ず確認する。
- `localStorage` キーは `voice-agent-shell.*`、IndexedDB は `voice-agent-shell.dataviz`。「新しい会話」で会話・ログ・データ・可視化を全消去。
- スキル（`agent/skills/*.js`）は決定的な文字列にし、現在日時やデータ一覧を入れない。ガイドの目次を載せるときは番号と見出しを
  `reference/*.md` と一致させる（`test/reference-index.test.js`）。
- 可視化フレームに渡す生成コードは `src/analysis/code-guard.js` の `inspectCode` で検査する。フレームは `blob:` を親から読めないので
  画像は data: URL で埋める。
- `@google/genai` は `useVoiceSession` の動的 import 経由でのみ読む（初期チャンクに入れない）。

## 参考
切り出し元: gee-ai-agent（Google Earth Engine 分析エージェント。地図レイヤー・データセット・チャート・PortWatch を持つ。
`capture_map`〔地図スクショ〕は `extraTools`、レイヤー一覧は `contextParts` / `buildContext`、チャートカードは `renderMessage` に対応する）。
ドメイン注入の実例は兄弟リポジトリ（github.com/shimizu/web-gis-ai-agent, github.com/shimizu/portwatch-dashboard）を参照。
`README.md`（ツールソース契約のコード例、ドメインを足す 7 手順）も併読する。
詳細ドキュメントは `docs/`（`README.md` が索引: usage / architecture / agent-loop / voice / extending）。仕組みを変えたら該当ファイルも更新する。

## コミット規約
プレフィックスを付ける: `feat:` / `fix:` / `docs:` / `refactor:` / `perf:` / `test:` / `chore:` / `style:`。
