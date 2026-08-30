// データ可視化ツールのソース。
//
// 役割: { id, skills, register(registry, deps) } の契約を満たし、データセット系と描画系のツールを登録する。
//       read_reference（ガイドの詳細参照）は後続の段階で足す。
// 関係: tools/sources.js の SOURCES に載る。deps は App.jsx の agentDeps
//       （datasetStore / visualizationStore / vizBridge / getAnalysisResult / postChatMessage / log …）。
//       スキルは agent/skills/dataviz-*.js。
import { DATAVIZ_CHARTS_SKILL } from '../../agent/skills/dataviz-charts.js'
import { DATAVIZ_WORKFLOW_SKILL } from '../../agent/skills/dataviz-workflow.js'
import {
  DATAVIZ_TOOL_DEFINITIONS,
  DESCRIBE_DATASET,
  LIST_DATASETS,
  RENDER_VISUALIZATION,
  SAVE_DATASET,
  UPDATE_VISUALIZATION,
} from './definitions.js'
import { makeDatasetHandlers } from './dataset-handlers.js'
import { makeVisualizationHandlers } from './visualization-handlers.js'

const definition = (name) => DATAVIZ_TOOL_DEFINITIONS.find((d) => d.name === name)

export const datavizSource = {
  id: 'dataviz',
  skills: [DATAVIZ_WORKFLOW_SKILL, DATAVIZ_CHARTS_SKILL],
  register(registry, deps = {}) {
    const data = makeDatasetHandlers(deps)
    const viz = makeVisualizationHandlers(deps)
    registry
      .register(definition(LIST_DATASETS), () => data.listDatasets())
      .register(definition(DESCRIBE_DATASET), (input) => data.describeDataset(input))
      .register(definition(SAVE_DATASET), (input) => data.saveDataset(input))
      .register(definition(RENDER_VISUALIZATION), (input) => viz.renderVisualization(input))
      .register(definition(UPDATE_VISUALIZATION), (input) => viz.updateVisualization(input))
  },
}
