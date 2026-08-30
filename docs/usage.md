# 使い方

対応ソース: `src/components/*`, `src/hooks/useSettings.js`, `package.json`, `vite.config.js`

## 前提

- Node 20 以上（`~/.npmrc` の `min-release-age` を設定している場合は新しすぎるパッケージが入らないことがある）。
- マイクは **HTTPS または localhost** でのみ使える（`getUserMedia` の制約）。
- API キー: Claude（必須）、Gemini（音声で相談する場合のみ）。どちらもブラウザの localStorage にだけ保存され、バンドルに埋め込まれない。
  ブラウザから直接 API を叩く構成なので**個人・社内利用向け**。公開サービスにするならキーを隠すプロキシかエフェメラルトークンが必要。

## セットアップ

```bash
npm install
npm run dev        # http://localhost:5173
```

初回アクセスでは About モーダル（アプリの説明と必要な設定）が出る。閉じると `introSeen` が保存され、以後はヘッダーの ⓘ About で再表示できる。

## API キーの設定（⚙ 設定）

ヘッダー右端の **⚙ 設定** でポップオーバーが開く。

| 項目 | 既定値 | 説明 |
|---|---|---|
| Claude API キー | — | `sk-ant-...`。**必須**。未設定だとチャット欄が無効になる |
| Claude モデル | `claude-opus-4-8` | Messages API に渡すモデル ID |
| 最大出力トークン (max_tokens) | 16000 | 1 応答あたりの上限 |
| Gemini API キー（音声で相談） | — | `AIza...`。任意。未設定だと 🎙 ボタンが無効になる |
| Gemini モデル（Live） | `gemini-3.1-flash-live-preview` | Live API 対応モデル |
| 声（Gemini prebuilt voice） | `Kore`（落ち着き） | 30 種から選ぶ |
| Google 検索グラウンディング | OFF | 音声側で Google 検索を使う。**別課金** |

- **接続テスト**（Claude / Gemini それぞれ）は課金なしのモデル一覧取得でキーを検証する。
  - 緑（ok）: キー有効、モデル名も一覧にある
  - 黄（warn）: キーは有効だが、入力中のモデル名が一覧に無い（入力ミスの可能性。候補を表示）
  - 赤（error）: 認証エラー（401/403）、ネットワーク／CSP でブロック、キーに全角文字・空白が混入 など
- キーや モデル名を変えると古いテスト結果は消える。
- **保存して閉じる**で localStorage に書く（キーは前後の空白を除去）。
- **キーを削除**で Claude / Gemini のキーだけ消す（モデル名などの設定は残る）。

## チャット（右パネル「チャット」タブ）

1. 入力欄に自然言語で指示を書く。**Ctrl/⌘ + Enter** で送信（送信ボタンでも可）。
2. Claude がツールを使いながら進める。途中の説明文は控えめな「progress」表示、最終回答は Markdown で表示される。
3. 実行中は **中断** ボタンで止められる（「中断しました。」が出る）。
4. 「エージェント」見出し横の **ⓘ（使い方）** ボタンでサンプルプロンプト（時刻・計算・音声で相談）が開き、クリックで入力欄に挿入される。
5. **新しい会話** は確認ダイアログの後、会話・チャット表示・ログを**すべて消去**する（設定は残る）。
6. 直前と同じ内容を連続で送ると警告が出て送信されない（誤送信の防止）。

サンプルツールで試せる指示: 「(12.5 + 3) × 4 を計算して」「ニューヨークとロンドンは今何時？」「1 年は何秒？」

### ログタブ

ツール呼び出しと音声セッションの出来事が時刻付きで並ぶ（直近 300 件、リロードしても残る）。

| 記号 | 意味 |
|---|---|
| `▶ name {input}` | ツール開始（入力は 100 文字で省略） |
| `✓ name` / `✗ name: message` | ツール成功 / 失敗（失敗は Claude に返され自己修正される） |
| `🎙` | 音声セッションの開始・終了・完了通知 |
| `✓ 音声: run_prompt → 実行開始` / `✗ 音声: …` | Gemini からの関数呼び出し |
| `🔎 音声: 検索: … 出典: …` | Google 検索グラウンディングの検索語と出典 |

## 音声で相談（🎙 ボタン）

入力欄の横の **🎙 音声で相談** を押すとマイク許可 → Gemini Live に接続する。ボタンのラベルが状態を示す。

| 表示 | 状態 |
|---|---|
| 音声で相談 | 待機中 |
| 接続中… | 接続とマイク取得中 |
| 聞き取り中 m:ss | こちらの発話を聞いている |
| 応答中 m:ss | Gemini が話している（話しかけると割り込める） |
| 音声エラー | 失敗（メッセージがボタン下に出る） |

流れ:

1. やりたいことを話す。曖昧なら Gemini が 1 つずつ質問して要件を埋める。
2. 十分具体的になると Gemini が `run_prompt` でチャット入力欄に指示文を書き込み、**そのまま送信**する
   （チャットタブと右パネルが自動で開く）。「実行を依頼しました。少しお待ちください」と言う。
3. Claude の実行が終わると Gemini に完了通知が送られ、結果を 1〜2 文で読み上げて次の指示を聞く。
4. Claude 実行中に再度依頼しても busy で拒否され、完了を待つよう案内される。
5. もう一度 🎙 を押すと終了。Gemini の書き起こし（応答テキスト）はボタンの下に表示される。

セッションはサーバー都合で終了予告（`goAway`）が来ることがある（ログに「まもなく終了」）。その場合は押し直して再接続する。

## スマホでの利用

- `.app-shell` は `visualViewport` の実高さに合わせるので、URL バーやキーボードの出入りで送信ボタンが画面外に出ない。
- 720px 以下はモバイルレイアウト。ヘッダーの **パネル ◨** で右パネルを開閉でき、パネル上縁のハンドルで高さを変えられる。
- マイクは HTTPS 配信（例: GitHub Pages）が必要。

## ビルド・デプロイ

```bash
npm run build      # dist/ に出力。CSP meta を注入する
npm run preview    # ビルド結果をローカルで確認（CSP 有効 = 本番相当）
npm run deploy     # gh-pages で dist/ を公開（predeploy で build が走る）
```

`base: './'` で相対パス出力なので、サブパス配信（`https://<user>.github.io/<repo>/`）でも動く。
**dev では CSP が効かない**ため、外部ホストを足したときは `npm run preview` で本番相当を確認する。

## テスト・lint

```bash
npm test                          # node --test（ブラウザ非依存の純ロジックのみ）
node --test test/runtime.test.js  # 1 ファイルだけ
npm run lint                      # ESLint、警告 0 が条件
```

テスト対象: runtime / tool-registry / claude-client / compaction / system-prompt+system-context / voice-tools / voice-instruction /
gemini-live-tools（`buildLiveTools`）/ voice-pcm / gemini-test / example-tools。描画・音声（WebAudio / DOM / WebSocket）は
`npm run dev` での手動確認で担保する。

## トラブルシューティング

| 症状 | 原因と対処 |
|---|---|
| 「Claude APIキーに使用できない文字（全角文字・空白・改行など）が含まれています」 | HTTP ヘッダは Latin-1 のみ。コピー時の全角空白などが混入。貼り直す |
| 接続テストが 401 / 403 | キーが無効、またはそのキーで使えないモデル・権限。キーを確認 |
| 接続テストが黄色（warn） | キーは有効だがモデル名が一覧に無い。表示される候補から選ぶ |
| 「API に到達できません（ネットワーク / CSP / 拡張機能のブロック）」 | 広告ブロッカー等の拡張、社内プロキシ、本番なら `vite.config.js` の `connect-src` 漏れ |
| 「マイクの使用が許可されませんでした」 | ブラウザのサイト設定でマイクを許可。HTTP（非 localhost）では使えない |
| 本番だけ `Unable to load a worklet's module.` | `pcm-worklet.js` がインライン化されている。`vite.config.js` の `assetsInlineLimit` と CSP `script-src 'self'` を確認 |
| dev では動くのに本番で API に繋がらない | CSP。外部ホストを `connect-src`（画像なら `img-src`）に追加 |
| Gemini が「実行中なので待って」と言い続ける | Claude が長い処理中。チャットの「中断」で止められる。終わると完了通知が届く |
| Claude が「反復上限」の要約で終わる | ツールが大きな結果を返して打ち切られ、同じ呼び出しを繰り返している可能性。ツールは要約だけ返す設計にする（[agent-loop.md](./agent-loop.md)） |
| 429 / 500 / 529 | クライアントが最大 3 回、指数バックオフ（`Retry-After` 優先）で再試行する。続くなら時間を置く |
| 会話がおかしくなった | 「新しい会話」で `conversation` / `chat-view` / ログを消す |
| 音声が 15 分前後で切れる | Live セッションの既定上限。`contextWindowCompression` を入れているが、切れたら 🎙 を押し直す |

## localStorage を手で消したいとき

すべてのキーは `voice-agent-shell.` で始まる（[architecture.md](./architecture.md#localstorage) に一覧）。DevTools → Application → Local Storage で削除する。
