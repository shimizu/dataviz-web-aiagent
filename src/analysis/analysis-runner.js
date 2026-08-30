// 生成 JavaScript の実行オーケストレータ（使い捨て Web Worker）。
//
// 役割: 事前検査 → 入力上限の確認 → Worker で実行（タイムアウト付き）→ 必ず terminate →
//       出力の JSON 互換性とサイズを検証、までを行い構造化された実行ログを返す。例外は投げず status で返す。
//       ドメインには依存しない（dataset の中身は解釈せず、そのまま Worker へ渡すだけ）。
// 関係: tools/javascript/handlers.js が呼ぶ。Worker 本体は analysis-worker.js。
//       createWorker / タイマーは注入できる（テストは偽 Worker を渡す）。
// 流用元: e-Stat-Web-AI-Agent/src/analysis/analysis-runner.js
import { hashCode, inspectCode } from './code-guard.js'

// 既定の制限値。ドメイン側で変えるならツールソースから options で渡す。
export const DEFAULT_TIMEOUT_MS = 5000
export const DEFAULT_MAX_INPUT_RECORDS = 200000
export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000

// 既定の Worker 生成。Vite が analysis-worker.js を別チャンクとして解決する。
function defaultCreateWorker() {
  return new Worker(new URL('./analysis-worker.js', import.meta.url), { type: 'module' })
}

// UTF-8 のバイト数。
function byteLength(text) {
  return new TextEncoder().encode(text).length
}

// JSON 互換か（関数・undefined・循環参照を含まないか）を検証しつつ正規化する。非互換なら例外。
function toJsonCompatible(value) {
  return JSON.parse(JSON.stringify(value ?? null))
}

// ドメイン由来のデータセットを Worker へ渡す形へ均す。records / columns 以外は metadata にまとめる。
function toWorkerDataset(item) {
  return {
    records: item?.records ?? [],
    columns: item?.columns ?? [],
    metadata: { datasetId: item?.id ?? null, ...(item?.metadata ?? {}) },
  }
}

/**
 * 生成 JavaScript を使い捨て Worker で実行し、構造化された実行ログを返す。
 *
 * @param {object} params
 * @param {string} params.code analyze 関数を定義する JavaScript
 * @param {object} [params.dataset] 主データセット { id, records, columns, metadata }
 * @param {Record<string, object>} [params.datasets] 複数データセット（datasets[id] で参照させる）
 * @param {object} [params.args] analyze へ渡す追加引数
 * @param {string} [params.now] computedAt に使う ISO 文字列（テスト用）
 * @returns {Promise<{status:'success'|'rejected'|'timeout'|'error', code, codeHash, datasetId,
 *   parameters, resultColumns, rows, warnings, durationMs, computedAt, error?}>}
 */
export async function runAnalysisCode(
  { code, dataset = null, datasets = {}, args = {}, now } = {},
  {
    createWorker = defaultCreateWorker,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxInputRecords = DEFAULT_MAX_INPUT_RECORDS,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    setTimeoutFn = globalThis.setTimeout.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
    nowFn = () => Date.now(),
  } = {},
) {
  const computedAt = now ?? new Date().toISOString()
  const datasetEntries = Object.entries(datasets ?? {})
  const base = {
    code,
    codeHash: hashCode(code),
    datasetId: dataset?.id ?? null,
    parameters: { args, ...(datasetEntries.length > 0 ? { datasetIds: datasetEntries.map(([id]) => id) } : {}) },
    resultColumns: [],
    rows: [],
    warnings: [],
    computedAt,
  }

  // 1. 実行前検査（誤操作の早期検出）。
  const guard = inspectCode(code)
  if (!guard.ok) {
    return { ...base, status: 'rejected', durationMs: 0, error: `禁止された参照を検出しました: ${guard.reasons.join(', ')}` }
  }

  // 2. 入力件数の上限。
  const records = dataset?.records ?? []
  const totalInputRecords =
    datasetEntries.length > 0
      ? datasetEntries.reduce((sum, [, item]) => sum + (item?.records?.length ?? 0), 0)
      : records.length
  if (totalInputRecords > maxInputRecords) {
    return {
      ...base,
      status: 'rejected',
      durationMs: 0,
      error: `入力レコードが上限（${maxInputRecords}）を超えています: ${totalInputRecords}`,
    }
  }

  const input = {
    ...toWorkerDataset(dataset),
    ...(datasetEntries.length > 0
      ? { datasets: Object.fromEntries(datasetEntries.map(([id, item]) => [id, toWorkerDataset(item)])) }
      : {}),
    args,
  }

  // 3. Worker で実行（完了・失敗・タイムアウトのいずれでも terminate）。
  const worker = createWorker()
  const start = nowFn()
  let timer

  const settle = await new Promise((resolve) => {
    timer = setTimeoutFn(() => resolve({ ok: false, timeout: true }), timeoutMs)
    worker.onmessage = (event) => resolve(event.data)
    worker.onerror = (event) => resolve({ ok: false, error: event?.message ?? 'Worker error' })
    try {
      worker.postMessage({ code, input })
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })

  clearTimeoutFn(timer)
  try {
    worker.terminate()
  } catch {
    // terminate の失敗は無視する。
  }

  const durationMs = Math.max(0, Math.round(nowFn() - start))

  // 4. 結果の判定。
  if (settle?.timeout) {
    return { ...base, status: 'timeout', durationMs, error: `実行が ${timeoutMs}ms のタイムアウトに達しました` }
  }
  if (!settle?.ok) {
    return { ...base, status: 'error', durationMs, error: settle?.error ?? '不明なエラー' }
  }

  // 5. 出力の JSON 互換性とサイズ。
  let normalized
  try {
    normalized = toJsonCompatible(settle.result)
  } catch {
    return { ...base, status: 'error', durationMs, error: '結果が JSON 互換ではありません（関数や循環参照は返せません）' }
  }
  const serialized = JSON.stringify(normalized ?? null)
  if (byteLength(serialized) > maxOutputBytes) {
    return { ...base, status: 'error', durationMs, error: `出力が上限（${maxOutputBytes} バイト）を超えています` }
  }

  return {
    ...base,
    status: 'success',
    durationMs,
    resultColumns: Array.isArray(normalized?.columns) ? normalized.columns : [],
    rows: Array.isArray(normalized?.rows) ? normalized.rows : [],
    warnings: Array.isArray(normalized?.notes) ? normalized.notes : [],
    sourceRecordCount: totalInputRecords,
  }
}
