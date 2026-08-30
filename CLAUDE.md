# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**音声（Gemini Live）× ツール実行（Claude）** のブラウザ完結型エージェントの最小シェル。バックエンドを持たず、
Claude API と Gemini Live API をブラウザから直接呼ぶ。API キーは画面で入力し localStorage に保存する。
gee-ai-agent からドメイン非依存の骨格だけを切り出したもので、同梱のサンプルツールソース（`tools/example/`: 現在時刻・計算）を
雛形にドメインを足す。

## コマンド

```bash
npm install        # 依存インストール（Node 20+。~/.npmrc の min-release-age に注意）
npm run dev        # Vite 開発サーバー（http://localhost:5173）
npm run build      # 本番ビルド（dist/）。CSP meta を注入する
npm run preview    # ビルド結果のプレビュー
npm run lint       # ESLint（--max-warnings 0）
npm test           # node --test（ブラウザ非依存の純ロジックのみ）
npm run deploy     # gh-pages で dist/ を公開（predeploy で build。vite.config.js の base:'./' 前提）
node --test test/runtime.test.js   # 単一テストファイルの実行
```

ESLint は `dist/` を無視する。

テストは Node 標準の `node --test`。ブラウザ依存（WebAudio / DOM / WebSocket）に触れない純ロジックだけを対象にする
（runtime / tool-registry / claude-client / compaction / system-prompt+system-context / voice-tools / voice-instruction /
gemini-live-tools〔buildLiveTools〕/ voice-pcm / gemini-test / example-tools / analysis-runner〔code-guard・偽 Worker〕/
javascript-tools）。描画・音声は `npm run dev` での手動確認で担保する。

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
`runtime.js`（tool use ループ、`is_error` で自己修正、`TOOL_RESULT_CHAR_CAP`）、`claude-client.js`（直叩き・リトライ・プロンプトキャッシュ）、
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
`settings.js` のみ。`STORAGE_PREFIX = 'voice-agent-shell.'` と `storageKey(name)` が localStorage キーの単一情報源
（設定・会話・チャット表示・ログのキーはすべてここから作る）。

### App.jsx のドメイン注入点
`agentDeps`（useMemo）/ `buildSystem`（`contextParts`）/ `voiceExtraTools` / `useVoiceSession` の `buildContext`・`buildSnapshot` /
`ChatPanel` の `renderMessage` / `Header` の `leftSlot` / `.workspace-main` の中身（地図・キャンバス等）。

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
- `localStorage` キーは `voice-agent-shell.*`。「新しい会話」で会話・ログを全消去。
- `@google/genai` は `useVoiceSession` の動的 import 経由でのみ読む（初期チャンクに入れない）。

## 参考
切り出し元: gee-ai-agent（Google Earth Engine 分析エージェント。地図レイヤー・データセット・チャート・PortWatch を持つ。
`capture_map`〔地図スクショ〕は `extraTools`、レイヤー一覧は `contextParts` / `buildContext`、チャートカードは `renderMessage` に対応する）。
ドメイン注入の実例は兄弟リポジトリ（github.com/shimizu/web-gis-ai-agent, github.com/shimizu/portwatch-dashboard）を参照。
`README.md`（ツールソース契約のコード例、ドメインを足す 7 手順）も併読する。
詳細ドキュメントは `docs/`（`README.md` が索引: usage / architecture / agent-loop / voice / extending）。仕組みを変えたら該当ファイルも更新する。

## コミット規約
プレフィックスを付ける: `feat:` / `fix:` / `docs:` / `refactor:` / `perf:` / `test:` / `chore:` / `style:`。
