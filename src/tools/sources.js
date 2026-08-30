// ツールソースの一覧（拡張ポイント）。
//
// 役割: 各ソースは { id, skills: [Markdown 文字列...], register(registry, deps) } を export し、
//       ここに 1 行足すだけでツール登録とシステムプロンプト（スキル）の両方へ反映される。
// 関係: register-tools.js（登録）と hooks/useAgentSession.js（スキル連結）が読む。
//       サンプルの example ソースが雛形（tools/example/ + agent/skills/example.js）。
import { exampleSource } from './example/index.js'
import { javascriptSource } from './javascript/index.js'

export const SOURCES = [exampleSource, javascriptSource]
