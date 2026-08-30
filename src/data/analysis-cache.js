// execute_javascript の実行結果（全行）を短期保持するキャッシュ。
//
// 役割: JS ツールが LLM へ返すのは先頭 20 行だけなので、全行はここに残しておき、
//       save_dataset({ codeHash }) で派生データセットに昇格できるようにする。永続化しない（会話中だけ）。
// 関係: App.jsx が deps.onAnalysisResult（tools/javascript が success 時に呼ぶ）と
//       tools/dataviz の getAnalysisResult に同じインスタンスを渡す。
export const DEFAULT_CAPACITY = 5

export function createAnalysisCache({ capacity = DEFAULT_CAPACITY } = {}) {
  let entries = []
  return {
    // JS ツールの成功結果を受ける（deps.onAnalysisResult）。
    put(result) {
      if (!result || !result.codeHash) return
      entries = [
        { codeHash: result.codeHash, resultColumns: result.resultColumns ?? [], rows: result.rows ?? [], computedAt: result.computedAt, datasetId: result.datasetId ?? null, code: result.code },
        ...entries.filter((e) => e.codeHash !== result.codeHash),
      ].slice(0, capacity)
    },
    get(codeHash) {
      return entries.find((e) => e.codeHash === codeHash) ?? null
    },
    latest() {
      return entries[0] ?? null
    },
    hashes() {
      return entries.map((e) => e.codeHash)
    },
    clear() {
      entries = []
    },
  }
}

export const analysisCache = createAnalysisCache()
