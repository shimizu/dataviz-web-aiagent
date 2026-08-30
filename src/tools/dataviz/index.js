// データ可視化ツールのソース。
//
// 役割: { id, skills, register(registry, deps) } の契約を満たし、データセット系・描画系・リファレンス参照のツールを登録する。
// 関係: tools/sources.js の SOURCES に載る。deps は App.jsx の agentDeps
//       （datasetStore / visualizationStore / vizBridge / getAnalysisResult / postChatMessage / log …）。
//       スキルは agent/skills/dataviz-*.js（進め方 → チャート → 地図 → GeoJSON 診断 → ラスタ の順に連結）。
import { DATAVIZ_CHARTS_SKILL } from '../../agent/skills/dataviz-charts.js'
import { DATAVIZ_GEOJSON_SKILL } from '../../agent/skills/dataviz-geojson.js'
import { DATAVIZ_MAPS_SKILL } from '../../agent/skills/dataviz-maps.js'
import { DATAVIZ_RASTER_SKILL } from '../../agent/skills/dataviz-raster.js'
import { DATAVIZ_WORKFLOW_SKILL } from '../../agent/skills/dataviz-workflow.js'
import {
  DATAVIZ_TOOL_DEFINITIONS,
  DESCRIBE_DATASET,
  LIST_DATASETS,
  READ_REFERENCE,
  RENDER_VISUALIZATION,
  SAVE_DATASET,
  UPDATE_VISUALIZATION,
} from './definitions.js'
import { makeDatasetHandlers } from './dataset-handlers.js'
import { makeReferenceHandlers } from './reference-handlers.js'
import { makeVisualizationHandlers } from './visualization-handlers.js'

const definition = (name) => DATAVIZ_TOOL_DEFINITIONS.find((d) => d.name === name)

export const datavizSource = {
  id: 'dataviz',
  skills: [DATAVIZ_WORKFLOW_SKILL, DATAVIZ_CHARTS_SKILL, DATAVIZ_MAPS_SKILL, DATAVIZ_GEOJSON_SKILL, DATAVIZ_RASTER_SKILL],
  register(registry, deps = {}) {
    const data = makeDatasetHandlers(deps)
    const viz = makeVisualizationHandlers(deps)
    const ref = makeReferenceHandlers(deps)
    registry
      .register(definition(LIST_DATASETS), () => data.listDatasets())
      .register(definition(DESCRIBE_DATASET), (input) => data.describeDataset(input))
      .register(definition(SAVE_DATASET), (input) => data.saveDataset(input))
      .register(definition(RENDER_VISUALIZATION), (input) => viz.renderVisualization(input))
      .register(definition(UPDATE_VISUALIZATION), (input) => viz.updateVisualization(input))
      .register(definition(READ_REFERENCE), (input) => ref.readReference(input))
  },
}
