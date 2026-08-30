// アップロードデータと可視化の永続化（IndexedDB の薄いラッパ）。
//
// 役割: files / datasets / visualizations の 3 ストアを持つ DB を開き、Promise で読み書きする。
//       IndexedDB が使えない環境（プライベートモード・テスト）では **例外を投げずに黙って諦める**
//       （メモリ上のストアだけで画面は動く。永続しないだけ）。
// 関係: record-store.js が使う。localStorage 側のキーと同じ接頭辞を storageKey() から作る。
//       raster の Float32Array は structured clone でそのまま保存できる（JSON 化しない）。
import { storageKey } from './settings.js'

export const DB_NAME = storageKey('dataviz')
export const DB_VERSION = 1
export const STORE_FILES = 'files'
export const STORE_DATASETS = 'datasets'
export const STORE_VISUALIZATIONS = 'visualizations'
export const STORE_NAMES = [STORE_FILES, STORE_DATASETS, STORE_VISUALIZATIONS]

let dbPromise = null

// DB を開く（失敗したら null）。1 度だけ開いて使い回す。
export function openDatabase() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    const idb = globalThis.indexedDB
    if (!idb) {
      resolve(null)
      return
    }
    let request
    try {
      request = idb.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

// トランザクションを 1 つ回す共通処理。db が無ければ fallback を返す。
async function withStore(storeName, mode, run, fallback) {
  const db = await openDatabase()
  if (!db) return fallback
  return new Promise((resolve) => {
    let tx
    try {
      tx = db.transaction(storeName, mode)
    } catch {
      resolve(fallback)
      return
    }
    const request = run(tx.objectStore(storeName))
    tx.onabort = () => resolve(fallback)
    tx.onerror = () => resolve(fallback)
    tx.oncomplete = () => resolve(request ? request.result : fallback)
  })
}

export function getAllRecords(storeName) {
  return withStore(storeName, 'readonly', (store) => store.getAll(), [])
}

export function putRecord(storeName, record) {
  return withStore(storeName, 'readwrite', (store) => store.put(record), null)
}

export function deleteRecord(storeName, id) {
  return withStore(storeName, 'readwrite', (store) => store.delete(id), null)
}

export function clearStore(storeName) {
  return withStore(storeName, 'readwrite', (store) => store.clear(), null)
}

// 「新しい会話」で全部消す。
export async function clearAllStores() {
  await Promise.all(STORE_NAMES.map((name) => clearStore(name)))
}
