# ドキュメント索引

voice-agent-shell の設計と使い方をまとめたドキュメントです。コードの実態を裏取りして書いているので、
コードを変えたらここも更新してください（各ファイル冒頭に対応するソースを書いています）。

| ドキュメント | 内容 | こんなときに読む |
|---|---|---|
| [usage.md](./usage.md) | セットアップ、API キー設定、チャット／音声の操作、ビルド・デプロイ、トラブルシューティング | まず動かしたい |
| [architecture.md](./architecture.md) | レイヤ構成と依存の向き、App.jsx の結線、画面構成、localStorage キー、ビルド設定（CSP） | 全体像を掴みたい・どこを触ればよいか知りたい |
| [agent-loop.md](./agent-loop.md) | Claude 側の仕組み: tool use ループ、自己修正、コンパクション、system ブロックとプロンプトキャッシュ、リトライ | Claude の挙動を変えたい・デバッグしたい |
| [voice.md](./voice.md) | Gemini Live 側の仕組み: 音声パイプライン、状態遷移、`run_prompt`、`extraTools`、完了通知の橋渡し | 音声まわりを変えたい・デバッグしたい |
| [extending.md](./extending.md) | ドメインを足す手順: ツールソース契約、スキル、deps、contextParts、extraTools、renderMessage、テスト | 自分のドメインのエージェントを作りたい |

## 読む順番の目安

1. **使ってみる** → `usage.md`
2. **構造を知る** → `architecture.md`
3. **足したい側の仕組み** → `agent-loop.md`（ツール・スキル）／ `voice.md`（音声）
4. **実装する** → `extending.md`

## 関連ファイル

- [`../README.md`](../README.md) — プロジェクトの概要と最短のセットアップ
- [`../CLAUDE.md`](../CLAUDE.md) / [`../AGENTS.md`](../AGENTS.md) — AI コーディングエージェント向けの要約（守るべき前提・コードスタイル）
- 切り出し元・兄弟プロジェクト（ドメイン注入の実例）: [gee-ai-agent](https://github.com/shimizu/gee-ai-agent) /
  [web-gis-ai-agent](https://github.com/shimizu/web-gis-ai-agent) / [portwatch-dashboard](https://github.com/shimizu/portwatch-dashboard)
