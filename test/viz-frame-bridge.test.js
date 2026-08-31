import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { createVizFrameBridge } from '../src/viz/viz-frame-bridge.js'
import { DEFAULT_VIZ_HEIGHT, DEFAULT_VIZ_WIDTH, FRAME_MESSAGES, clampVizSize } from '../src/viz/frame-protocol.js'

// 偽 iframe / 偽 message 購読 / 偽タイマー。
function harness(options = {}) {
  const element = {
    attrs: {},
    src: '',
    setAttribute(k, v) {
      this.attrs[k] = v
    },
    remove() {
      this.removed = true
    },
    contentWindow: {
      posted: [],
      postMessage(msg) {
        this.posted.push(msg)
      },
    },
  }
  let handler = null
  const timers = new Map()
  let timerSeq = 0
  const bridge = createVizFrameBridge({
    src: 'viz-frame.html',
    createElement: () => element,
    subscribe: (fn) => {
      handler = fn
      return () => {
        handler = null
      }
    },
    setTimeoutFn: (fn, ms) => {
      const id = (timerSeq += 1)
      timers.set(id, { fn, ms })
      return id
    },
    clearTimeoutFn: (id) => timers.delete(id),
    ...options,
  })
  const fromFrame = (data) => handler?.({ source: element.contentWindow, data })
  const fireTimers = () => {
    for (const [id, t] of [...timers]) {
      timers.delete(id)
      t.fn()
    }
  }
  const posted = (type) => element.contentWindow.posted.filter((m) => m.type === type)
  return { bridge, element, fromFrame, fireTimers, timers, posted }
}

test('sandbox 属性を付け、リスナー登録後に src を設定する', () => {
  const { bridge, element } = harness()
  assert.equal(element.attrs.sandbox, 'allow-scripts')
  assert.equal(element.src, 'viz-frame.html')
  assert.equal(bridge.getState().isReady, false)
})

test('ready 前の render は待機し、ready 後に既定サイズで要求して結果を返す', async () => {
  const { bridge, fromFrame, posted } = harness()
  const promise = bridge.render({ code: 'function render(){}', datasetIds: ['ds_001'] })
  await Promise.resolve()
  assert.equal(posted(FRAME_MESSAGES.RENDER).length, 0)
  fromFrame({ type: FRAME_MESSAGES.READY, runtimeVersion: '1' })
  await new Promise((r) => setTimeout(r, 0))
  const [req] = posted(FRAME_MESSAGES.RENDER)
  assert.ok(req)
  assert.equal(req.width, DEFAULT_VIZ_WIDTH)
  assert.equal(req.height, DEFAULT_VIZ_HEIGHT)
  assert.deepEqual(req.datasetIds, ['ds_001'])
  fromFrame({ type: FRAME_MESSAGES.RESULT, requestId: req.requestId, ok: true, svg: '<svg/>', warnings: [] })
  const result = await promise
  assert.equal(result.ok, true)
  assert.equal(result.svg, '<svg/>')
  assert.equal(result.width, DEFAULT_VIZ_WIDTH)
  assert.equal(bridge.getState().runtimeVersion, '1')
})

test('putDataset は同じ ID を再送しない', async () => {
  const { bridge, fromFrame, posted } = harness()
  fromFrame({ type: FRAME_MESSAGES.READY })
  assert.equal(await bridge.putDataset({ id: 'ds_001', records: [] }), true)
  assert.equal(await bridge.putDataset({ id: 'ds_001', records: [] }), false)
  assert.equal(posted(FRAME_MESSAGES.PUT_DATASET).length, 1)
  bridge.forgetDataset('ds_001')
  assert.equal(await bridge.putDataset({ id: 'ds_001', records: [] }), true)
  await assert.rejects(bridge.putDataset({}), /dataset\.id/)
})

test('描画タイムアウトで reject し、フレームをリロードして送信済み記録を捨てる', async () => {
  const { bridge, element, fromFrame, fireTimers, posted } = harness()
  fromFrame({ type: FRAME_MESSAGES.READY })
  await bridge.putDataset({ id: 'ds_001' })
  const promise = bridge.render({ code: 'while(true){}', datasetIds: ['ds_001'], width: 100, height: 100000 })
  await new Promise((r) => setTimeout(r, 0))
  const [req] = posted(FRAME_MESSAGES.RENDER)
  assert.equal(req.width, 320, '最小サイズに丸める')
  assert.equal(req.height, 4096, '最大サイズに丸める')
  fireTimers()
  await assert.rejects(promise, /タイムアウト/)
  const state = bridge.getState()
  assert.equal(state.isReady, false)
  assert.deepEqual(state.loadedIds, [])
  assert.equal(state.generation, 1)
  assert.ok(element.src.startsWith('viz-frame.html?r='))

  // 再起動後は ready を待ってから次の要求を送る
  const next = bridge.render({ code: 'function render(){}', datasetIds: [] })
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(posted(FRAME_MESSAGES.RENDER).length, 1)
  fromFrame({ type: FRAME_MESSAGES.READY })
  await new Promise((r) => setTimeout(r, 0))
  const req2 = posted(FRAME_MESSAGES.RENDER)[1]
  fromFrame({ type: FRAME_MESSAGES.RESULT, requestId: req2.requestId, ok: false, error: { message: 'x' } })
  const result = await next
  assert.equal(result.ok, false)
})

test('ready のタイムアウトは案内付きのエラー', async () => {
  const { bridge, fireTimers } = harness()
  const promise = bridge.render({ code: '', datasetIds: [] })
  await Promise.resolve()
  fireTimers()
  await assert.rejects(promise, /build:runtime/)
})

test('別の source からのメッセージと未知の type は無視する', async () => {
  const { bridge, fromFrame } = harness()
  // handler に別 source を渡す
  const state0 = bridge.getState()
  fromFrame({ type: 'other' })
  assert.deepEqual(bridge.getState(), state0)
})

test('clear は送信済み記録を捨て、ready 後なら frame にも通知する', async () => {
  const { bridge, fromFrame, posted } = harness()
  bridge.clear()
  assert.equal(posted(FRAME_MESSAGES.CLEAR).length, 0)
  fromFrame({ type: FRAME_MESSAGES.READY })
  await bridge.putDataset({ id: 'a' })
  bridge.clear()
  assert.equal(posted(FRAME_MESSAGES.CLEAR).length, 1)
  assert.deepEqual(bridge.getState().loadedIds, [])
})

test('dispose 後は render が失敗し、要素を外す', async () => {
  const { bridge, element } = harness()
  bridge.dispose()
  assert.equal(element.removed, true)
  await assert.rejects(bridge.render({ code: '', datasetIds: [] }), /破棄/)
})

test('clampVizSize と frame 側スクリプトのメッセージ文字列が一致する', () => {
  assert.equal(clampVizSize(undefined, 960), 960)
  assert.equal(clampVizSize('abc', 600), 600)
  assert.equal(clampVizSize(10, 600), 320)
  assert.equal(clampVizSize(99999, 600), 4096)
  const frameSource = readFileSync(new URL('../public/viz-frame.js', import.meta.url), 'utf8')
  for (const value of Object.values(FRAME_MESSAGES)) {
    assert.ok(frameSource.includes(`'${value}'`), `public/viz-frame.js に ${value} が無い`)
  }
  for (const lib of ['d3: window.d3', 'turf: window.turf', 'geoWarp: window.geoWarp', 'pretext: window.pretext']) {
    assert.ok(frameSource.includes(lib), `public/viz-frame.js が ${lib} を render に渡していない`)
  }
})
