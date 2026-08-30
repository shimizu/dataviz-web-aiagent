// データ可視化用ストアの購読フック。
//
// 役割: モジュールスコープのストア（dataset-store / file-store）を React の再描画に繋ぐ。
//       ストア本体は App の外にあるので `agentDeps` は参照安定のまま保てる（registry を作り直さない）。
// 関係: components/dataviz/* へ props で流す。永続層からの復元（hydrate）は App が起動時に 1 回呼ぶ。
import { useCallback, useEffect, useSyncExternalStore } from 'react'

// ストアの一覧を購読する。
export function useStoreItems(store) {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

// IndexedDB からの復元が済んだか（済むまではツールを使わせない）。
export function useHydrated(store) {
  const getHydrated = useCallback(() => store.isHydrated(), [store])
  return useSyncExternalStore(store.subscribe, getHydrated, getHydrated)
}

// 起動時に 1 回だけ復元する。
export function useHydrateOnce(stores) {
  // stores はモジュールスコープの固定配列（参照が変わらない）ので、依存に入れても初回だけ走る。
  useEffect(() => {
    for (const store of stores) store.hydrate()
  }, [stores])
}
