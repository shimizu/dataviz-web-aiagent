// JS 実行ツールの実装。
//
// 役割: 入力の datasetId / datasetIds を deps.getDataset で解決して runAnalysisCode へ渡し、
//       結果を「LLM へ返す要約」に絞る。コード全文と全行は返さない（行データはアプリ側で保持する）。
//       success 以外（rejected / timeout / error）は例外にして runtime.js に is_error で返させ、モデルに直させる。
// 関係: index.js が deps をそのまま渡して作る（log / getDataset / runOptions / onAnalysisResult）。
//       runOptions は analysis-runner の制限値（timeoutMs / maxInputRecords / maxOutputBytes）、runCode はテストの注入点。
//       onAnalysisResult(result) は成功時の**全行を含む結果**をアプリへ渡すフック（dataviz の save_dataset が
//       codeHash で拾って派生データセットにする）。シェル単体では未注入で何も起きない。
import { runAnalysisCode } from '../../analysis/analysis-runner.js'

// LLM へ返す行数の上限（全行はアプリ側にある想定）。
export const LLM_RESULT_ROWS = 20

function resolveDataset(getDataset, id) {
  const dataset = getDataset(id)
  if (!dataset) throw new Error(`データセットが見つかりません: ${id}`)
  return dataset
}

export function makeJavascriptHandlers({ log, getDataset, runCode = runAnalysisCode, runOptions, onAnalysisResult } = {}) {
  return {
    async executeJavascript({ code, datasetId, datasetIds, args } = {}) {
      if (typeof code !== 'string' || !code.trim()) throw new Error('code が空です（analyze 関数を定義する JavaScript を渡す）')

      const ids = Array.isArray(datasetIds) ? [...new Set(datasetIds)] : []
      if ((datasetId || ids.length > 0) && typeof getDataset !== 'function') {
        throw new Error('このアプリはデータセットを提供していません。データは args に渡す')
      }

      const dataset = datasetId ? resolveDataset(getDataset, datasetId) : null
      const datasets = {}
      for (const id of ids) datasets[id] = resolveDataset(getDataset, id)
      if (ids.length > 0 && datasetId && !datasets[datasetId]) datasets[datasetId] = dataset

      const result = await runCode({ code, dataset, datasets, args: args ?? {} }, runOptions)
      log?.(`JS 実行 [${result.codeHash}] ${result.status}（${result.durationMs}ms）${result.error ? `: ${result.error}` : ''}`)

      if (result.status !== 'success') throw new Error(`JavaScript の実行に失敗しました（${result.status}）: ${result.error}`)

      // 全行はアプリ側へ渡す（LLM には先頭 20 行だけ返す）。
      try {
        onAnalysisResult?.(result)
      } catch {
        // 保存側の失敗で分析結果を捨てない。
      }

      const rows = result.rows.slice(0, LLM_RESULT_ROWS)
      return {
        codeHash: result.codeHash,
        ...(result.datasetId ? { datasetId: result.datasetId } : {}),
        sourceRecordCount: result.sourceRecordCount ?? 0,
        resultColumns: result.resultColumns,
        rows,
        rowCount: result.rows.length,
        truncatedRows: result.rows.length > rows.length,
        warnings: result.warnings,
        durationMs: result.durationMs,
        computedAt: result.computedAt,
      }
    },
  }
}
