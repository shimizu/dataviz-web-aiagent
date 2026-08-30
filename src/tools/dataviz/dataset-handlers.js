// データセット系ツールの実装（list / describe / save）。
//
// 役割: ストアから要約を作って返す。tool_result は 8000 文字で打ち切られるので、**自前で切り詰めて**
//       truncated を明示する（打ち切られた理由が Claude に伝わるように）。
//       例外はそのまま投げる（runtime が is_error にして自己修正させる）。メッセージは直し方が分かる日本語にする。
// 関係: index.js が deps を渡して作る。deps = { datasetStore, getAnalysisResult, log, ... }。
import { describeDataset, summarizeDataset } from '../../data/dataset-shapes.js'
import { profileColumn } from '../../data/parsers/tabular.js'

// tool_result の打ち切り（8000）より手前で自分で絞る。
export const MAX_RESULT_CHARS = 7000

function jsonSize(value) {
  try {
    return JSON.stringify(value).length
  } catch {
    return Infinity
  }
}

// 大きすぎる要約を、サンプル → 統計の順に落として収める（純関数・テスト対象）。
export function capDescription(description, maxChars = MAX_RESULT_CHARS) {
  if (jsonSize(description) <= maxChars) return description
  const dropped = []
  let result = { ...description }
  const sampleKey = result.sample ? 'sample' : result.sampleProperties ? 'sampleProperties' : null
  if (sampleKey && Array.isArray(result[sampleKey]) && result[sampleKey].length > 2) {
    result = { ...result, [sampleKey]: result[sampleKey].slice(0, 2) }
    dropped.push('サンプルを 2 件に削減')
  }
  if (jsonSize(result) > maxChars) {
    const key = result.columns ? 'columns' : result.properties ? 'properties' : null
    if (key && Array.isArray(result[key])) {
      result = { ...result, [key]: result[key].map((c) => ({ name: c.name, type: c.type })) }
      dropped.push('列の統計を省略（stats: false と同じ内容）')
    }
  }
  if (jsonSize(result) > maxChars && sampleKey) {
    result = { ...result, [sampleKey]: [] }
    dropped.push('サンプルを省略')
  }
  if (jsonSize(result) > maxChars && Array.isArray(result.columns)) {
    result = { ...result, columns: result.columns.slice(0, 40), columnsTruncated: true }
    dropped.push('列を先頭 40 個に削減')
  }
  return { ...result, truncated: dropped }
}

// execute_javascript の結果（columns + rows）を tabular の保存形にする（純関数・テスト対象）。
export function analysisResultToDataset(entry, name) {
  const columnNames = (entry.resultColumns ?? []).map((c) => String(c))
  const rows = entry.rows ?? []
  if (rows.length === 0) throw new Error('保存できる行がありません（rows が空の結果は保存しません）')

  const records = rows.map((row) => {
    if (Array.isArray(row)) {
      const record = {}
      columnNames.forEach((col, i) => {
        record[col] = row[i] ?? null
      })
      return record
    }
    if (row && typeof row === 'object') return row
    return { value: row }
  })
  const names = columnNames.length > 0 ? columnNames : [...new Set(records.flatMap((r) => Object.keys(r)))]
  const columns = names.map((col) => {
    const values = records.map((r) => (r[col] === undefined ? null : r[col]))
    const type = values.every((v) => v == null || typeof v === 'number')
      ? 'number'
      : values.every((v) => v == null || typeof v === 'boolean')
        ? 'boolean'
        : 'string'
    return profileColumn(col, type, values)
  })
  return {
    kind: 'tabular',
    name,
    columns,
    records,
    rowCount: records.length,
    diagnostics: [],
    derivedFrom: { codeHash: entry.codeHash, datasetIds: entry.datasetId ? [entry.datasetId] : [] },
  }
}

export function makeDatasetHandlers({ datasetStore, getAnalysisResult, log } = {}) {
  const requireStore = () => {
    if (!datasetStore) throw new Error('データセットストアが利用できません')
    if (typeof datasetStore.isHydrated === 'function' && !datasetStore.isHydrated()) {
      throw new Error('保存済みデータの読み込み中です。数秒待ってからもう一度実行してください')
    }
    return datasetStore
  }

  const requireDataset = (id) => {
    const store = requireStore()
    const key = String(id ?? '').trim()
    if (!key) throw new Error('id が空です。list_datasets の id を指定してください')
    const dataset = store.get(key)
    if (!dataset) {
      const known = store.getSnapshot().map((d) => d.id)
      throw new Error(
        known.length > 0
          ? `データセットが見つかりません: ${key}（利用できるのは ${known.join(', ')}）`
          : `データセットが見つかりません: ${key}（まだ何も読み込まれていません。画面左の「データ」タブにファイルをドロップするようユーザーに伝えてください）`,
      )
    }
    return dataset
  }

  return {
    listDatasets() {
      const store = requireStore()
      const datasets = store.getSnapshot()
      if (datasets.length === 0) {
        return {
          datasets: [],
          note: 'まだデータが読み込まれていません。「データ」タブに csv / tsv / geojson / geotiff をドロップするようユーザーに案内してください',
        }
      }
      return { datasets: datasets.map(summarizeDataset), count: datasets.length }
    },

    describeDataset({ id, sample = 5, stats = true } = {}) {
      const dataset = requireDataset(id)
      log?.(`データセットを確認: ${dataset.id}（${dataset.name}）`)
      return capDescription(describeDataset(dataset, { sample, stats }))
    },

    saveDataset({ name, codeHash } = {}) {
      const store = requireStore()
      const label = String(name ?? '').trim()
      if (!label) throw new Error('name が空です。保存名を指定してください')
      if (typeof getAnalysisResult !== 'function') throw new Error('このアプリでは分析結果の保存に対応していません')
      const key = String(codeHash ?? '').trim()
      const entry = getAnalysisResult(key)
      if (!entry) {
        throw new Error(
          `codeHash ${key || '(空)'} の実行結果が見つかりません。先に execute_javascript を実行し、その戻り値の codeHash を渡してください`,
        )
      }
      const saved = store.add({ ...analysisResultToDataset(entry, label), sourceFileId: null, byteSize: 0 })
      log?.(`分析結果を保存: ${saved.id}（${saved.name}・${saved.rowCount} 行）`)
      return { id: saved.id, name: saved.name, rowCount: saved.rowCount, columns: saved.columns.map((c) => `${c.name}:${c.type}`) }
    },
  }
}
