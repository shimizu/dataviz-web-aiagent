// アップロード原本のストア（メモリ優先 + IndexedDB 永続）。
//
// 役割: 取り込んだファイルのバイト列 / テキストをそのまま保持する。zip 書き出し（M4）で元データを同梱するため、
//       パース後の正規化形とは別に原本を残す。表示には使わない。
// 関係: import-files.js が追加し、viz/zip-export.js が読む。dataset.sourceFileId で結び付く。
import { createRecordStore } from './record-store.js'
import { STORE_FILES } from './dataviz-db.js'

export function createFileStore(options = {}) {
  return createRecordStore({ storeName: STORE_FILES, idPrefix: 'file', ...options })
}

export const fileStore = createFileStore()
