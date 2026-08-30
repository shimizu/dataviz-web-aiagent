// データ可視化ツールのソース。
//
// 役割: { id, skills, register(registry, deps) } の契約を満たし、データセット系ツールを登録する。
//       描画系（render_visualization / update_visualization）と read_reference は後続の段階で足す。
// 関係: tools/sources.js の SOURCES に載る。deps は App.jsx の agentDeps
//       （datasetStore / getAnalysisResult / log …）。スキルは agent/skills/dataviz-*.js。
import { DATAVIZ_WORKFLOW_SKILL } from '../../agent/skills/dataviz-workflow.js'
import { DATAVIZ_TOOL_DEFINITIONS, DESCRIBE_DATASET, LIST_DATASETS, SAVE_DATASET } from './definitions.js'
import { makeDatasetHandlers } from './dataset-handlers.js'

const definition = (name) => DATAVIZ_TOOL_DEFINITIONS.find((d) => d.name === name)

export const datavizSource = {
  id: 'dataviz',
  skills: [DATAVIZ_WORKFLOW_SKILL],
  register(registry, deps = {}) {
    const h = makeDatasetHandlers(deps)
    registry
      .register(definition(LIST_DATASETS), () => h.listDatasets())
      .register(definition(DESCRIBE_DATASET), (input) => h.describeDataset(input))
      .register(definition(SAVE_DATASET), (input) => h.saveDataset(input))
  },
}
