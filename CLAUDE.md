# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**データ可視化エージェント**。ユーザーが csv / tsv / geojson / geotiff をブラウザにドロップし、チャットか音声で相談しながら
**Claude が D3 / Observable Plot の描画コードを書いて図を作る**。図は隔離 iframe で実行して SVG に落とし、
SVG / PNG / ZIP で書き出せる。バックエンド無しのブラウザ完結型で、API キーは localStorage、データと図は IndexedDB に保存する。
骨格は voice-agent-shell（音声 Gemini Live × ツール実行 Claude のシェル）。

## コマンド

```bash
npm install            # Node 20+
npm run dev            # Vite 開発サーバー（http://localhost:5173）。predev で viz-runtime を生成
npm run build          # 本番ビルド（dist/）。CSP meta を注入。prebuild で viz-runtime を生成
npm run build:runtime  # public/viz-runtime.js（d3 + geo-projection + geo-polygon + Plot + turf + geoWarp + pretext の IIFE）だけ生成
npm run preview        # ビルド結果のプレビュー（CSP が効く唯一のローカル確認手段）
npm run lint           # ESLint（--max-warnings 0。dist/ と public/viz-runtime.js と reference/ は対象外）
npm test               # node --test（ブラウザ非依存の純ロジックのみ）
node --test test/runtime.test.js   # 単一テストファイルの実行
npm run deploy         # gh-pages で dist/ を公開（base:'./' 前提）
```

テストは Node 標準 `node --test` で、WebAudio / DOM / WebSocket / IndexedDB に触れない純ロジックだけを対象にする。
描画・音声・CSP の確認は `npm run build && npm run preview` を Chromium（Playwright）で叩く。
**Claude API は Playwright の `page.route('https://api.anthropic.com/v1/messages')` で tool_use を順に返すモックにできる**
（キー不要で取り込み → render → update → 書き出しまで E2E が回る。手順は `~/.claude/debug.md`）。

## アーキテクチャ

詳細は `docs/`（`README.md` が索引: usage / architecture / agent-loop / voice / extending）。仕組みを変えたら該当ファイルも更新する。
ここには複数ファイルにまたがる全体像と、コードから読み取りにくい制約だけを書く。

### レイヤ分離（最重要）

依存の向きは **components → hooks → (agent | tools | voice | data)**。

- `src/components/` は**表示と入力のみ**。API 呼び出し・推論・ツール実行を直書きしない。
- `src/agent/` と `src/voice/` は互いを知らず、`src/tools/` も import しない。
  繋ぐのは `src/hooks/useAgentSession.js`（tools → agent）と `src/App.jsx`（agent ↔ voice）だけ。
- `src/App.jsx` が**唯一の結線点**。`src/hooks/` の結線フック（useSettings / useAgentSession / useVoiceSession / useVisualViewport）を依存順に組み立てる。
- `useAgentSession` の `deps`（= ツールソースへ渡る `agentDeps`）は**参照安定**が必須（registry を deps でメモ化しており、変わると作り直される）。

### 2 系統 LLM の役割分担

- **Claude**（`src/agent/`）= 実作業。ツール定義とスキルを持ち、tool use ループで `is_error` を見て自己修正する。
- **Gemini Live**（`src/voice/`）= 会話。**ドメインのツールは渡さない**。渡すのは `run_prompt`（チャット入力欄に書いて送信まで行う）と
  アプリが `extraTools` で注入した関数だけ。Claude 実行中の `run_prompt` は busy で拒否。
- 橋渡しは App の `agentFinishedRef`: `useAgentSession.onFinished` → `useVoiceSession.notifyAgentFinished` → `sendText`（読み上げ）。
  会話中の状態変化は `sendText` で伝えず、ツール応答に `buildSnapshot()` を同梱する。
- `extraTools` で画像を見せるときは handler 内で `session.sendImage()` を**先に**呼んでから応答を返す（逆だとモデルが画像を見ずに話す）。
- `@google/genai` は `useVoiceSession` の**動的 import** 経由でのみ読む（初期チャンクに入れない）。UI から音声の定数が要るときは
  genai 非依存の `voice/voice-options.js` から読む。

### エージェント層（`src/agent/`）

`runtime.js`（tool use ループ。ツール結果の `_image` は画像付き tool_result になり、終了時に画像をテキストへ畳んで localStorage 永続化を守る）、
`claude-client.js`（直叩き・リトライ・プロンプトキャッシュ）、`compaction.js`（古い tool_result をプレースホルダ化）、
`system-prompt.js`（BASE + スキル）+ `system-context.js`（安定プレフィックス〔cache_control〕+ 揮発ブロック〔現在日時 + contextParts〕の 2 ブロック構成）。
**スキル（`agent/skills/*.js`）は決定的な文字列にする**（現在日時やデータ一覧を入れない。cache_control 付き安定プレフィックスに載るため。
揮発情報は `system-context.js` の揮発ブロックで渡す）。
スキルは `dataviz-{workflow,charts,maps,geojson,raster}.js`。各スキルは「守る規則（MUST）→ 本文 → よくある事故と修正 → 目次」の順で、
目次の番号と見出しは `reference/*.md` と一致させる（`test/reference-index.test.js` が突き合わせる）。
**実際の描画事故を見つけたら該当スキルの「よくある事故と修正」に ❌/✅ で追記する。**

### ツール層（`src/tools/`）— 拡張ポイント

各ソースは `src/tools/<source>/index.js` で `{ id, skills: [Markdown...], register(registry, deps) }` を export し、
`src/tools/sources.js` の `SOURCES` に 1 行足すだけでツール登録とシステムプロンプトの両方に反映される。
**ツールは要約だけを LLM に返す**（行データ・地物はアプリ側のストアへ置き ID で参照させる）。例外はそのまま投げ、
runtime が `is_error` にして Claude に自己修正させる。ドメインを足す 7 手順は README / `docs/extending.md` を参照。

- `dataviz/`（本体）: `list_datasets` / `describe_dataset` / `save_dataset` / `render_visualization` / `update_visualization` / `read_reference`。
  render 成功時は `snapshotSvg` で PNG を撮り `_image` として返し、Claude が自分の図を見て自己批評 → update する。
  失敗はエラー + スタック 3 行 + console を 1 メッセージにして `is_error`。
- `javascript/`: `execute_javascript`（生成 JS を隔離 Worker で実行。基盤は `src/analysis/`: 実行前検査 → 使い捨て Worker →
  タイムアウト → 必ず terminate → 出力検証。既定 5 秒 / 入力 20 万件 / 出力 1MB。Worker へ API キー・DOM・localStorage は渡さない）。

### 可視化層（`src/viz/`・`src/viz-runtime/`・`public/`）

- 生成コードは **`public/viz-frame.html` を `sandbox="allow-scripts"`（opaque origin）の iframe** で実行する。
  frame 自身の CSP（`script-src 'self' 'unsafe-eval'; connect-src 'none'` 等）で `new Function` を許可しつつ外部通信・親の
  localStorage / DOM を遮断する。**親の `vite.config.js` の CSP は変更しない**（Chromium で実測済み）。
- `public/viz-runtime.js` は `vite.runtime.config.js` で作る生成物（gitignore）。frame の `<script src>` と ZIP 同梱で共用。
- メッセージ種別は `src/viz/frame-protocol.js` が正で、`public/viz-frame.js`（手書き classic script）内の写しとテストが突き合わせる。
- **基本チャートは Observable Plot で組む**が、Plot の `title` / `legend` は `<figure>` を作り単一 svg 契約を壊すのでフレームがエラーにする
  （タイトル・凡例は外側 svg + Plot svg の入れ子で組み、width/height 属性をインラインスタイルへ焼き込んで Plot 内蔵 CSS のずれを補正する）。
- frame の警告にはデザイン検査（ラベル重なり・端切れ・9px 未満・塗り色相 > 8・近白塗り）を含む。
- `viz-frame-bridge.js`: ready ハンドシェイク・描画の直列化・タイムアウト時は iframe リロードで復旧。
  **iframe は DOM から外すと再読み込み、`display:none` はレイアウト値を壊す**ので、非表示時は画面外へ退避する。
- 書き出し: `svg-export.js` / `png-export.js`（data: URL → canvas 2x。blob: 不使用）/ `zip-export.js`（fflate、`file://` で開ける構成）/
  `font-embed.js`（`<img>` に読んだ SVG は外部フォントを取得しないため、使用文字と交差する unicode-range チャンクだけ data: 化して埋め込む。失敗時はシステムフォントで続行）。
- デザイントークンは `viz-theme.js` が単一正本（スキルの表もここから生成）。

### データ層（`src/data/`）

- `settings.js` の `STORAGE_PREFIX = 'voice-agent-shell.'` と `storageKey(name)` が localStorage キーの単一情報源。
  IndexedDB は `voice-agent-shell.dataviz`（`files` / `datasets` / `visualizations`）。「新しい会話」で会話・ログ・データ・可視化を全消去（設定は残る）。
- `record-store.js` は**メモリ優先 + IDB は永続化のみ**。`get` が同期なのは `execute_javascript` の `deps.getDataset` が同期呼び出しのため。
  起動時に App が `hydrate()`、完了までチャット無効。ストアはモジュールスコープの単一インスタンスを App と `agentDeps` が共有する（参照安定）。
- `parsers/tabular.js` は **`d3-dsv` の `parse()` でなく `parseRows()`** を使う（`parse()` は `new Function` を使い本番 CSP で落ちる）。
- 取り込み上限: CSV 20 万行 / GeoJSON 20MB / GeoTIFF 50MB（GeoTIFF は長辺 2048 に間引き。ZSTD / LERC / JPEG は未対応エラー）。

## CSP（vite.config.js）— dev では効かない

本番ビルドのみ CSP meta を注入する。**dev サーバーでは CSP が適用されない**ため、外部ホストやライブラリを足したら
`npm run preview` で必ず確認する（「dev では動くのに本番だけ壊れる」典型）。

- 外部ホストを増やしたら `connect-src` / `img-src` を更新する。
- `execute_javascript` の `new Function` は **Worker のグローバルスコープ**で動き、document の meta CSP は Worker に継承されない
  （同一オリジンの実ファイルとして読むため）。よって `script-src` は `'self'` のままでよい（Chromium で実測済み）。
  メインスレッド側で `new Function` / `eval` を使うなら `'unsafe-eval'` が要る。**ライブラリが内部で `new Function` を使うことがある**
  （例: `d3-dsv` の `parse()`）。
- `pcm-worklet.js` は `assetsInlineLimit` でインライン化を禁止している（worklet のモジュール取得は script-src の対象で、
  data: URL にされると CSP で弾かれる）。

## 可視化フォント

**英数字 = Roboto Condensed（先）→ 和文 = Noto Sans JP（後）** のフォールバック順（`theme.font.family`。
**逆にすると英数字も Noto の字形になる**）。`index.html` と `public/viz-frame.html` の両方で Google Fonts を読み込み、
frame は初回 render 前に `document.fonts` を最大 3 秒待つ（pretext 実測とデザイン検査の字形ズレ防止）。
CSP は親・frame とも style-src に fonts.googleapis.com / font-src に fonts.gstatic.com（親の connect-src には埋め込み fetch 用に両ホスト）。

## コードスタイル

プレーン JS/JSX（TypeScript なし）、2 スペース、セミコロン無し、シングルクォート。コンポーネントは `PascalCase.jsx`、
モジュールは `kebab-case.js`。各モジュール先頭に「役割 / 関係 / 流用元」のヘッダーコメントを置く。UI 文言・コメントは日本語。

## その他の前提

- マイク開始などブラウザの権限が絡む処理はクリックハンドラから同期的に開始する。
- 可視化フレームに渡す生成コードは `src/analysis/code-guard.js` の `inspectCode` で検査する（文字列検査は誤操作の早期検出にすぎない）。
  フレームは `blob:` を親から読めないので画像は data: URL で埋める。
- ブラウザ直叩きなので**個人・社内利用向け**。公開サービス化にはキーを隠すプロキシが必要。
