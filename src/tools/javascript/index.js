// JS 実行ツールのソース。
//
// 役割: { id, skills, register(registry, deps) } の契約を満たし、execute_javascript を 1 つ登録する。
//       deps.getDataset(id) が注入されていれば datasetId / datasetIds を受け付ける形の定義になる。
// 関係: tools/sources.js の SOURCES に載る。スキルは agent/skills/javascript.js。実行基盤は analysis/。
import { JAVASCRIPT_SKILL } from '../../agent/skills/javascript.js'
import { buildJavascriptToolDefinition } from './definitions.js'
import { makeJavascriptHandlers } from './handlers.js'

export const javascriptSource = {
  id: 'javascript',
  skills: [JAVASCRIPT_SKILL],
  register(registry, deps = {}) {
    const h = makeJavascriptHandlers(deps)
    const definition = buildJavascriptToolDefinition({ hasDatasets: typeof deps.getDataset === 'function' })
    registry.register(definition, (input) => h.executeJavascript(input))
  },
}
