// ツール登録。
//
// 役割: SOURCES の各ソースに deps を渡して ToolRegistry へ登録する。重複名は ToolRegistry が例外にする。
// 関係: hooks/useAgentSession.js が useMemo で 1 回だけ作る。
//
// deps の形:
//   { postChatMessage, session, log, ...アプリ固有の依存（ストア・コールバック等。シェルは中身を見ない） }
//   - postChatMessage({ kind, ... }): ツールからチャットへ任意 kind のメッセージを出す（表示は ChatPanel の renderMessage）
//   - session: { originPrompt } 実行中のユーザー指示など、ターン内で共有する軽い状態
//   - log(message): 実行ログ
//   - getDataset(id): 任意。注入すると execute_javascript が datasetId / datasetIds を受け付け、
//     { id, records, columns, metadata } を隔離 Worker へ渡す（未注入なら args だけのサンドボックス）
//   - onAnalysisResult(result): 任意。execute_javascript の成功結果（全行）を受け取る
//     （dataviz の save_dataset が codeHash で拾って派生データセットにする）
import { ToolRegistry } from '../agent/tool-registry.js'
import { SOURCES } from './sources.js'

export function createToolRegistry(deps, sources = SOURCES) {
  const registry = new ToolRegistry()
  for (const source of sources) source.register(registry, deps)
  return registry
}
