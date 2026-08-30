// 可視化フレーム（隔離 iframe）への親側ブリッジ。
//
// 役割: sandbox="allow-scripts" の iframe を作り、postMessage で「データセット送信 → 描画要求 → 結果受信」を行う。
//       ready ハンドシェイク・描画の直列化・タイムアウト（タイムアウト時は iframe をリロードして復旧）・
//       送信済みデータセットの記録（同じ ID は再送しない）を担う。生成コードの検査（inspectCode）は呼び出し側の責務。
// 注入: { src, createElement, subscribe, setTimeoutFn, clearTimeoutFn, readyTimeoutMs, renderTimeoutMs, log }
//       — テストは偽 iframe と偽タイマーを渡す。ブラウザでは既定値で動く。
// 関係: frame-protocol.js（メッセージ種別・既定値）、public/viz-frame.js（対向）、tools/dataviz（render ツール）、
//       components/dataviz/VizPanel.jsx（element を DOM に載せる。**DOM に無い iframe は読み込まれない**ので、
//       可視化タブが非表示でも要素は残し、display:none にしない〔レイアウト値が取れなくなる〕）。
import {
  DEFAULT_VIZ_HEIGHT,
  DEFAULT_VIZ_WIDTH,
  FRAME_MESSAGES,
  READY_TIMEOUT_MS,
  RENDER_TIMEOUT_MS,
  clampVizSize,
} from './frame-protocol.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function defaultSubscribe(handler) {
  globalThis.addEventListener('message', handler)
  return () => globalThis.removeEventListener('message', handler)
}

export function createVizFrameBridge({
  src,
  createElement = (tag) => globalThis.document.createElement(tag),
  subscribe = defaultSubscribe,
  setTimeoutFn = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeoutFn = (id) => globalThis.clearTimeout(id),
  readyTimeoutMs = READY_TIMEOUT_MS,
  renderTimeoutMs = RENDER_TIMEOUT_MS,
  log,
} = {}) {
  if (!src) throw new Error('createVizFrameBridge: src（viz-frame.html の URL）が必要です')

  const element = createElement('iframe')
  element.setAttribute?.('sandbox', 'allow-scripts')
  element.setAttribute?.('title', '可視化プレビュー')
  element.setAttribute?.('referrerpolicy', 'no-referrer')

  const loadedIds = new Set()
  const pending = new Map() // requestId → { resolve, reject, timer }
  let readyState = deferred()
  let isReady = false
  let readyTimer = null
  let runtimeVersion = null
  let disposed = false
  let seq = 0
  let queue = Promise.resolve()
  let generation = 0 // リロードのたびに増やす（古い結果を捨てる）

  const post = (message) => {
    element.contentWindow?.postMessage(message, '*')
  }

  const rejectPending = (error) => {
    for (const [, entry] of pending) {
      clearTimeoutFn(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  const onMessage = (event) => {
    if (disposed) return
    if (!element.contentWindow || event.source !== element.contentWindow) return
    const msg = event.data
    if (!msg || typeof msg.type !== 'string') return
    if (msg.type === FRAME_MESSAGES.READY) {
      isReady = true
      runtimeVersion = msg.runtimeVersion ?? null
      if (readyTimer != null) {
        clearTimeoutFn(readyTimer)
        readyTimer = null
      }
      log?.(`可視化フレーム起動（runtime v${runtimeVersion ?? '?'}）`)
      readyState.resolve()
      return
    }
    if (msg.type === FRAME_MESSAGES.RESULT) {
      const entry = pending.get(msg.requestId)
      if (!entry) return
      clearTimeoutFn(entry.timer)
      pending.delete(msg.requestId)
      entry.resolve(msg)
    }
  }

  const unsubscribe = subscribe(onMessage)
  // リスナーを登録してから src を設定する（ready の取りこぼし防止）。
  element.src = src

  // フレームをリロードして復旧（暴走コードの唯一の止め方）。送信済みデータセットは消えるので記録も捨てる。
  const reload = (reason) => {
    generation += 1
    isReady = false
    loadedIds.clear()
    rejectPending(new Error(`可視化フレームを再起動しました（${reason}）。もう一度実行してください`))
    if (readyTimer != null) {
      clearTimeoutFn(readyTimer)
      readyTimer = null
    }
    readyState = deferred()
    readyState.promise.catch(() => {})
    log?.(`可視化フレーム再起動: ${reason}`)
    const sep = src.includes('?') ? '&' : '?'
    element.src = `${src}${sep}r=${generation}`
  }

  // 起動完了を待つ。初回の待機開始時にタイムアウトを仕込む。
  const ready = () => {
    if (disposed) return Promise.reject(new Error('可視化フレームは破棄済みです'))
    if (isReady) return Promise.resolve()
    if (readyTimer == null) {
      readyTimer = setTimeoutFn(() => {
        readyTimer = null
        if (isReady) return
        const error = new Error(
          '可視化フレームが起動しません。public/viz-runtime.js が生成されているか（npm run build:runtime）と、フレームが画面に配置されているかを確認してください',
        )
        readyState.reject(error)
        readyState = deferred()
        readyState.promise.catch(() => {})
      }, readyTimeoutMs)
    }
    return readyState.promise
  }

  // データセットをフレームへ送る（同じ ID は再送しない）。送ったら true。
  const putDataset = async (dataset) => {
    if (!dataset || !dataset.id) throw new Error('putDataset: dataset.id が必要です')
    await ready()
    if (loadedIds.has(dataset.id)) return false
    post({ type: FRAME_MESSAGES.PUT_DATASET, dataset })
    loadedIds.add(dataset.id)
    return true
  }

  const doRender = async ({ code, datasetIds = [], width, height, theme }) => {
    await ready()
    const requestId = `r${(seq += 1)}`
    const gen = generation
    const request = {
      type: FRAME_MESSAGES.RENDER,
      requestId,
      code: String(code ?? ''),
      datasetIds: [...datasetIds],
      width: clampVizSize(width, DEFAULT_VIZ_WIDTH),
      height: clampVizSize(height, DEFAULT_VIZ_HEIGHT),
      theme: theme ?? {},
    }
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeoutFn(() => {
        pending.delete(requestId)
        reject(
          new Error(`描画がタイムアウトしました（${Math.round(renderTimeoutMs / 1000)} 秒）。無限ループや全件描画などの重すぎる処理がないか確認してください`),
        )
        if (generation === gen) reload('描画タイムアウト')
      }, renderTimeoutMs)
      pending.set(requestId, { resolve, reject, timer })
      post(request)
    })
    return { ...result, width: request.width, height: request.height }
  }

  // 描画は直列化する（フレームは 1 つの container を使い回すため）。
  const render = (request) => {
    const run = queue.then(() => doRender(request))
    queue = run.catch(() => {})
    return run
  }

  const clear = () => {
    loadedIds.clear()
    if (isReady) post({ type: FRAME_MESSAGES.CLEAR })
  }

  const forgetDataset = (id) => {
    loadedIds.delete(id)
  }

  const dispose = () => {
    disposed = true
    unsubscribe?.()
    rejectPending(new Error('可視化フレームを破棄しました'))
    if (readyTimer != null) clearTimeoutFn(readyTimer)
    element.remove?.()
  }

  const getState = () => ({ isReady, runtimeVersion, loadedIds: [...loadedIds], pendingCount: pending.size, generation })

  return { element, ready, putDataset, render, clear, forgetDataset, reload, dispose, getState }
}
