// メモリ優先 + IndexedDB 永続のレコードストア（データセット・ファイル・可視化の共通土台）。
//
// 役割: 一覧を配列で保持し、変更のたびに新しい配列に差し替えて購読者へ通知する（useSyncExternalStore 用に
//       getSnapshot の参照が安定していること）。読み取り（get）は**同期**にする — 既存の execute_javascript の
//       deps.getDataset(id) が同期呼び出しのため。IndexedDB は書き込みの後追い（永続化）にだけ使う。
// 関係: dataset-store.js / file-store.js / visualization-store.js が種別ごとに包む。
//       永続層は dataviz-db.js（使えない環境では黙ってメモリのみで動く）。
import { clearStore, deleteRecord, getAllRecords, putRecord } from './dataviz-db.js'
import { nextSequenceId } from '../utils/ids.js'

// persist=false にするとメモリのみ（テスト用）。
export function createRecordStore({ storeName, idPrefix, persist = true, db } = {}) {
  const io = db ?? { getAll: getAllRecords, put: putRecord, remove: deleteRecord, clear: clearStore }
  const listeners = new Set()
  let items = []
  let hydrated = false

  const emit = () => {
    for (const fn of [...listeners]) fn()
  }
  const commit = (next) => {
    items = next
    emit()
  }

  const subscribe = (fn) => {
    listeners.add(fn)
    return () => listeners.delete(fn)
  }

  // useSyncExternalStore 用（変更が無い限り同じ参照を返す）。
  const getSnapshot = () => items
  const isHydrated = () => hydrated
  const get = (id) => items.find((it) => it.id === id) ?? null
  const nextId = () => nextSequenceId(idPrefix, items.map((it) => it.id))

  // 起動時に IndexedDB から復元する。1 度だけ。
  const hydrate = async () => {
    if (hydrated) return items
    if (persist) {
      const stored = await io.getAll(storeName)
      if (Array.isArray(stored) && stored.length > 0) {
        commit([...stored].sort((a, b) => String(a.id).localeCompare(String(b.id))))
      }
    }
    hydrated = true
    emit()
    return items
  }

  const add = (record) => {
    const saved = { ...record, id: record.id ?? nextId(), createdAt: record.createdAt ?? new Date().toISOString() }
    commit([...items, saved])
    if (persist) io.put(storeName, saved)
    return saved
  }

  const update = (id, patch) => {
    const current = get(id)
    if (!current) return null
    const saved = { ...current, ...patch, id }
    commit(items.map((it) => (it.id === id ? saved : it)))
    if (persist) io.put(storeName, saved)
    return saved
  }

  const remove = (id) => {
    if (!get(id)) return false
    commit(items.filter((it) => it.id !== id))
    if (persist) io.remove(storeName, id)
    return true
  }

  const clear = () => {
    commit([])
    if (persist) io.clear(storeName)
  }

  return { subscribe, getSnapshot, isHydrated, hydrate, get, add, update, remove, clear, nextId }
}
