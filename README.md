# voice-agent-shell

**音声（Gemini Live）× ツール実行（Claude）** のブラウザ完結型エージェントの最小シェル。
バックエンドを持たず、Claude API と Gemini Live API をブラウザから直接呼びます。API キーは画面で入力し
localStorage に保存します。

[gee-ai-agent](https://github.com/shimizu/gee-ai-agent)（Google Earth Engine の分析エージェント）から、
ドメインに依存しない骨格だけを切り出したものです。同梱のサンプルツール（現在時刻・計算）を差し替えて、
自分のドメイン（地図・表・IoT・ドキュメント…）のエージェントを作る土台にしてください。

## 仕組み — 2 つの LLM の役割分担

```
 🎙 マイク ──► Gemini Live（音声で会話・要件を整理）
                  │  run_prompt(text)      ← Gemini に渡す関数はこれ（+ アプリ注入分）だけ
                  ▼
           チャット入力欄に書き込み → 送信
                  │
                  ▼
           Claude（tool use ループ）──► ツールソース（src/tools/*）
                  │  完了
                  ▼
           【Claude 完了】通知を Gemini にテキストで送る → 読み上げ
```

- **Claude** = 実作業担当。ツール定義とスキル（Markdown）を持ち、`is_error` で自己修正しながら反復する。
- **Gemini Live** = 会話担当。ドメインのツールは渡さず、`run_prompt`（指示文を書いて送信まで行う）と、
  アプリが注入した「画面を見る」系の関数だけを持つ。Claude 実行中の `run_prompt` は busy で拒否。
- 2 つは互いを知らない。App.jsx が `onFinished → notifyAgentFinished` で橋渡しする。

## セットアップ

```bash
npm install
npm run dev        # http://localhost:5173
```

1. ヘッダー右の ⚙ 設定に **Claude API キー**（必須）を入れ、「接続テスト」→「保存して閉じる」。
2. チャットに「(12.5 + 3) × 4 を計算して」「ニューヨークは今何時？」と入力すると、Claude がサンプルツールを呼んで答えます。
3. 音声で相談するには **Gemini API キー**（任意）を入れ、入力欄横の 🎙 を押して話しかけます。
   Gemini が要件を聞き取り、`run_prompt` で Claude を実行し、完了を読み上げます。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー |
| `npm run build` | 本番ビルド（`dist/`。CSP meta を注入） |
| `npm run preview` | ビルド結果のプレビュー（CSP 有効） |
| `npm run lint` | ESLint（警告 0） |
| `npm test` | `node --test`（ブラウザ非依存の純ロジック） |
| `npm run deploy` | `gh-pages` で `dist/` を公開 |

## ドキュメント

詳しい設計・仕組み・拡張手順は [`docs/`](./docs/README.md) にまとめています
（[使い方](./docs/usage.md) / [アーキテクチャ](./docs/architecture.md) / [Claude の tool use ループ](./docs/agent-loop.md) /
[Gemini Live 音声](./docs/voice.md) / [ドメインを足す手順](./docs/extending.md)）。

## 構成

```
src/
  App.jsx              唯一の結線点（ドメイン注入点はここ）
  agent/               Claude: runtime（tool use ループ）/ claude-client / tool-registry / compaction /
                       conversation-store / system-prompt（BASE + スキル）/ system-context（揮発ブロック）
    skills/example.js  サンプルスキル（Markdown）
  voice/               Gemini Live: gemini-live-client / voice-tools（run_prompt）/ voice-instruction /
                       audio-capture（16kHz worklet）/ audio-player（24kHz）/ pcm / voice-options / gemini-test
  analysis/            生成 JS の隔離実行: code-guard（実行前検査）/ analysis-worker（使い捨て Worker）/
                       analysis-runner（タイムアウト・入出力上限・terminate）
  hooks/               useSettings / useAgentSession / useVoiceSession / useVisualViewport
  tools/               sources.js（ソース一覧）/ register-tools.js / example/（サンプル: 時刻・計算）/
                       javascript/（execute_javascript: 生成 JS を隔離 Worker で実行）
  components/          表示と入力のみ（Header / Sidebar / TabbedPanel / ChatPanel / VoiceButton / ExecutionLog /
                       ApiSettings / AboutModal / AgentHelpModal）
  data/settings.js     localStorage のキー（接頭辞 voice-agent-shell.）と既定値
test/                  node --test
```

## ツールソースの契約

`src/tools/<source>/index.js` が次を export し、`src/tools/sources.js` の `SOURCES` に 1 行足すだけで
ツール登録とシステムプロンプト（スキル）の両方に反映されます。

```js
export const exampleSource = {
  id: 'example',
  skills: [EXAMPLE_SKILL],               // Markdown 文字列。決定的にする（現在日時などを入れない）
  register(registry, deps) {            // deps = { postChatMessage, session, log, ...アプリ固有 }
    const h = makeExampleHandlers(deps)
    registry
      .register(definition('get_current_time'), (input) => h.getCurrentTime(input))
      .register(definition('calculate'), (input) => h.calculate(input))
  },
}
```

- ツールは **要約だけ** を返す（行データや地物はアプリ側のストアに置き、ID で参照させる）。
- 例外はそのまま投げる。runtime が `is_error: true` の `tool_result` にして Claude に自己修正させる。
- `deps.postChatMessage({ kind, ... })` でチャットに任意 kind のメッセージを出せる（描画は `ChatPanel` の `renderMessage`）。

## ドメインを足す手順

1. `src/tools/<source>/{index,definitions,handlers}.js` と `src/agent/skills/<source>.js` を作り、`SOURCES` に追加。
2. `App.jsx` の `agentDeps`（`useMemo` で参照安定に）にストアやコールバックを入れる。
3. 毎ターン変わる状態（現在のレイヤー・選択中のデータなど）は `buildSystem` の `contextParts` に文字列 / 関数で足す
   （安定プレフィックスと別ブロックなのでプロンプトキャッシュを壊さない）。
4. 音声にも状況を伝えるなら `useVoiceSession` に `buildContext()`（接続時の指示文）と `buildSnapshot()`（ツール応答へ同梱）を渡す。
5. Gemini に「画面を見る」などの関数を足すなら `extraTools: [{ declaration, handler(args, { session, log }) }]`。
   画像を見せる場合は handler 内で `session.sendImage()` を**先に**呼んでから応答を返す（逆だと画像を見ずに話し始める）。
6. チャットに独自の kind（チャートカードなど）を出すなら `ChatPanel` の `renderMessage(message)` を渡す。
7. 外部ホストを叩くなら `vite.config.js` の CSP（`connect-src` / `img-src`）に追加する。dev では CSP が効かないので本番だけ壊れる。

## セキュリティ

- Claude / Gemini の API キーは localStorage（`voice-agent-shell.*`）にだけ保存。バンドルに埋め込まない。
- ブラウザ直叩きなので **個人・社内利用向け**。公開サービスにするならキーを隠すプロキシ（またはエフェメラルトークン）が必要。
- Gemini の Google 検索グラウンディング（設定のトグル、既定 OFF）は別課金。
