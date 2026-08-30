// サンプルのツールソース（時刻・計算）。ドメインを足すときの雛形。
//
// 役割: { id, skills, register(registry, deps) } の契約を満たす最小の例。
//       skills はシステムプロンプトに連結され、register は definitions と handlers を結ぶ。
// 関係: tools/sources.js の SOURCES に載る。スキルは agent/skills/example.js。
import { EXAMPLE_SKILL } from '../../agent/skills/example.js'
import { CALCULATE, EXAMPLE_TOOL_DEFINITIONS, GET_CURRENT_TIME } from './definitions.js'
import { makeExampleHandlers } from './handlers.js'

const definition = (name) => EXAMPLE_TOOL_DEFINITIONS.find((d) => d.name === name)

export const exampleSource = {
  id: 'example',
  skills: [EXAMPLE_SKILL],
  register(registry, deps = {}) {
    const h = makeExampleHandlers(deps)
    registry
      .register(definition(GET_CURRENT_TIME), (input) => h.getCurrentTime(input))
      .register(definition(CALCULATE), (input) => h.calculate(input))
  },
}
