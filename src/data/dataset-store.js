// データセットのストア（メモリ優先 + IndexedDB 永続）。
//
// 役割: 取り込み済みデータセットの単一情報源。**get は同期**（execute_javascript の deps.getDataset が同期のため）。
//       ツールへは要約だけ返し、行データ・地物・ラスタはここに置いたまま ID で参照させる。
// 関係: import-files.js（追加）、tools/dataviz（一覧・要約・派生の保存）、App.jsx（agentDeps / contextParts / 表示）。
import { createRecordStore } from './record-store.js'
import { STORE_DATASETS } from './dataviz-db.js'
import { summarizeDataset, toRuntimeDataset } from './dataset-shapes.js'

export function createDatasetStore(options = {}) {
  const store = createRecordStore({ storeName: STORE_DATASETS, idPrefix: 'ds', ...options })
  return {
    ...store,
    // 隔離実行（Worker / 可視化フレーム）へ渡す形。
    getRuntime: (id) => toRuntimeDataset(store.get(id)),
    list: () => store.getSnapshot().map(summarizeDataset),
  }
}

// アプリ全体で 1 つ（参照安定のためモジュールスコープ）。
export const datasetStore = createDatasetStore()
