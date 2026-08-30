// 可視化のストア（メモリ優先 + IndexedDB 永続）。
//
// 役割: 1 つの可視化を「タイトル + 使ったデータセット + バージョンの並び」として持つ。
//       各バージョンは { version, code, svg, warnings, stats, width, height, changeNote, createdAt }。
//       生成コードと SVG 文字列を保持し、書き出し（SVG / PNG / ZIP）と再描画の両方に使う。
// 関係: tools/dataviz/visualization-handlers.js（追加・更新）、components/dataviz/VizPanel（表示）。
import { createRecordStore } from './record-store.js'
import { STORE_VISUALIZATIONS } from './dataviz-db.js'

// 1 つの可視化が保持するバージョン数の上限（SVG を丸ごと持つので上限を設ける）。
export const MAX_VERSIONS = 10

export function createVisualizationStore(options = {}) {
  const store = createRecordStore({ storeName: STORE_VISUALIZATIONS, idPrefix: 'viz', ...options })

  // 新しい可視化を作る（version 1）。
  const create = ({ title, description = '', datasetIds = [], code, svg, warnings = [], stats = {}, width, height }) => {
    const now = new Date().toISOString()
    return store.add({
      title: String(title ?? '無題'),
      description,
      datasetIds: [...datasetIds],
      versions: [{ version: 1, code, svg, warnings, stats, width, height, changeNote: '', createdAt: now }],
      currentVersion: 1,
    })
  }

  // 既存の可視化に新しいバージョンを足す。
  const addVersion = (id, { code, svg, warnings = [], stats = {}, width, height, title, description, changeNote = '' }) => {
    const current = store.get(id)
    if (!current) return null
    const version = (current.versions.at(-1)?.version ?? 0) + 1
    const versions = [...current.versions, { version, code, svg, warnings, stats, width, height, changeNote, createdAt: new Date().toISOString() }]
    return store.update(id, {
      ...(title ? { title: String(title) } : {}),
      ...(description ? { description } : {}),
      versions: versions.slice(-MAX_VERSIONS),
      currentVersion: version,
    })
  }

  const selectVersion = (id, version) => store.update(id, { currentVersion: version })
  const getVersion = (id, version) => {
    const viz = store.get(id)
    if (!viz) return null
    const target = version ?? viz.currentVersion
    return viz.versions.find((v) => v.version === target) ?? viz.versions.at(-1) ?? null
  }

  return { ...store, create, addVersion, selectVersion, getVersion }
}

export const visualizationStore = createVisualizationStore()
