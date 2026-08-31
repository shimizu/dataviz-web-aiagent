# データ可視化エージェント

csv / tsv / geojson / geotiff をブラウザにドロップし、チャットか音声で相談しながら **Claude が D3 で図を作る**
エージェントです。データの確認 → 提案と質問 → 描画 → 修正を対話で進め、できた図は **SVG / PNG / ZIP**（html + js + css + データ。
ダブルクリックで開ける）で保存できます。バックエンドは無く、API キーは localStorage、データと図は IndexedDB に保存します。

骨格は [voice-agent-shell](https://github.com/shimizu/gee-ai-agent)（音声 Gemini Live × ツール実行 Claude のブラウザ完結型シェル）。
参考にした作図ガイドは [`reference/`](./reference/)（エージェントが `read_reference` で参照します）。

## できること

- **取り込み**: 「データ」タブに複数ファイルをドロップ。列の型推定・統計、GeoJSON の描画前診断、GeoTIFF の間引き読み込み。
- **対話**: 「売上の推移を折れ線で」→ Claude が `describe_dataset` で中身を読み、足りないことを質問し、
  `render_visualization` に D3 コードを渡して描く。「色を変えて」は `update_visualization` で新バージョンに。
- **安全な実行**: 生成コードは `sandbox="allow-scripts"` の隔離 iframe（自前 CSP、外部通信・親の localStorage 遮断）で動く。
- **書き出し**: SVG（単体で開ける）/ PNG（2 倍解像度）/ ZIP（`file://` でそのまま動く html + js + css + データ + ライブラリ）。
- **音声**（任意）: Gemini Live に相談すると指示文を作って Claude に依頼、完了を読み上げ。

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
2. 左の「データ」タブに csv / tsv / geojson / geotiff をドロップ（複数可）。列の型や地物の診断がその場で見えます。
3. チャットに「都市別の売上推移を折れ線で」と入力。Claude がデータを読んで図を描き、「可視化」タブに表示します。
   「注目したい系列だけ青に」「2024 年以降に絞って」のように直せます。
4. 「可視化」タブの SVG / PNG / ZIP ボタンで保存。ZIP は展開して `index.html` を開けば同じ図が動きます。
5. 音声で相談するには **Gemini API キー**（任意）を入れ、入力欄横の 🎙 を押して話しかけます。

| コマンド | 内容 |
|---|---|
| `npm run dev` | 開発サーバー（`predev` で `public/viz-runtime.js` を生成） |
| `npm run build` | 本番ビルド（`dist/`。CSP meta を注入。`prebuild` で viz-runtime を生成） |
| `npm run build:runtime` | 可視化ランタイム（d3 + turf + geoWarp + pretext の IIFE）だけを生成 |
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
public/
  viz-frame.html/.js   可視化フレーム（隔離 iframe。生成コードを new Function で実行し SVG 文字列を返す）
  viz-runtime.js       生成物（npm run build:runtime）。d3 + d3-geo-projection + d3-geo-polygon + turf + geoWarp + pretext
reference/             作図ガイド 4 本（スキルの要約元。read_reference が節単位で読む）
src/
  App.jsx              唯一の結線点（ストア・bridge・ツール deps・表示の結線）
  agent/               Claude: runtime（tool use ループ）/ claude-client / tool-registry / compaction /
                       conversation-store / system-prompt（BASE + スキル）/ system-context（揮発ブロック）
    skills/dataviz-*.js  進め方 + render 契約 / チャート / 地図 / GeoJSON 診断 / ラスタ（ガイドの要約）
  viz/                 frame-protocol / viz-frame-bridge（親側）/ viz-theme / svg・png・zip の書き出し / download
  viz-runtime/         geo-warp（ラスタの逆引き再投影）/ raster-paint（純関数）/ index（グローバル登録エントリ）
  data/                dataviz-db（IndexedDB）/ record-store / dataset・file・visualization-store / parsers（tabular・geojson・geotiff）/
                       import-files / dataset-shapes / analysis-cache / settings
  voice/               Gemini Live: gemini-live-client / voice-tools（run_prompt）/ voice-instruction /
                       audio-capture（16kHz worklet）/ audio-player（24kHz）/ pcm / voice-options / gemini-test
  analysis/            生成 JS の隔離実行: code-guard（実行前検査）/ analysis-worker（使い捨て Worker）/
                       analysis-runner（タイムアウト・入出力上限・terminate）
  hooks/               useSettings / useAgentSession / useVoiceSession / useVisualViewport
  tools/               sources.js（ソース一覧）/ register-tools.js /
                       dataviz/（list・describe・save_dataset / render・update_visualization / read_reference）/
                       example/（時刻・計算）/ javascript/（execute_javascript: 生成 JS を隔離 Worker で実行）
  components/          表示と入力のみ（dataviz/: DatavizWorkspace・DropZone・DatasetList・DatasetPreview・VizPanel・VizCard /
                       Header / Sidebar / TabbedPanel / ChatPanel / VoiceButton / ExecutionLog / ApiSettings / AboutModal / AgentHelpModal）
test/                  node --test（純ロジック。ブラウザは Playwright + Claude API モックで確認）
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
