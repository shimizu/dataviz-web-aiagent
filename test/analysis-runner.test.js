// 生成 JavaScript の実行基盤（事前検査・使い捨て Worker・上限）の単体テスト。
// Worker は偽物を注入する（ブラウザ非依存）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { findForbiddenTokens, hashCode, inspectCode } from '../src/analysis/code-guard.js'
import { runUserCode } from '../src/analysis/analysis-worker.js'
import { runAnalysisCode } from '../src/analysis/analysis-runner.js'

// 受け取ったコードを同期実行して返す偽 Worker。呼ばれた記録も残す。
function makeFakeWorker(behavior = {}) {
  const calls = []
  const worker = {
    calls,
    terminated: false,
    onmessage: null,
    onerror: null,
    postMessage(message) {
      calls.push(message)
      if (behavior.silent) return
      if (behavior.error) {
        this.onerror?.({ message: behavior.error })
        return
      }
      try {
        const result = behavior.run ? behavior.run(message) : runUserCode(message.code, message.input)
        this.onmessage?.({ data: { ok: true, result } })
      } catch (error) {
        this.onmessage?.({ data: { ok: false, error: error.message } })
      }
    },
    terminate() {
      this.terminated = true
    },
  }
  return worker
}

const options = (worker, extra = {}) => ({ createWorker: () => worker, nowFn: () => 0, ...extra })

test('code-guard: 禁止トークンを検出し、無害なコードは通す', () => {
  assert.deepEqual(findForbiddenTokens('const a = 1'), [])
  assert.deepEqual(findForbiddenTokens('fetch("https://example.com")'), ['fetch'])
  assert.deepEqual(inspectCode('localStorage.getItem("k")').reasons, ['localStorage'])
  assert.deepEqual(inspectCode('await import("x")').reasons, ['動的 import'])
  assert.equal(inspectCode('function analyze() { return { rows: [] } }').ok, true)
  // ハッシュは決定的で、内容が変われば変わる。
  assert.equal(hashCode('abc'), hashCode('abc'))
  assert.notEqual(hashCode('abc'), hashCode('abd'))
  assert.match(hashCode('abc'), /^[0-9a-f]{8}$/)
})

test('success: analyze の結果を columns / rows / notes へ整えて返す', async () => {
  const worker = makeFakeWorker()
  const code = `function analyze({ records, args }) {
    const total = records.reduce((s, r) => s + r.value, 0) * args.scale
    return { columns: ['total'], rows: [[total]], notes: ['ok'] }
  }`
  const result = await runAnalysisCode(
    { code, dataset: { id: 'd1', records: [{ value: 2 }, { value: 3 }], columns: ['value'] }, args: { scale: 10 }, now: 'T' },
    options(worker),
  )
  assert.equal(result.status, 'success')
  assert.deepEqual(result.rows, [[50]])
  assert.deepEqual(result.resultColumns, ['total'])
  assert.deepEqual(result.warnings, ['ok'])
  assert.equal(result.datasetId, 'd1')
  assert.equal(result.sourceRecordCount, 2)
  assert.equal(result.computedAt, 'T')
  assert.equal(worker.terminated, true)
})

test('Worker へ渡す input は records / columns / metadata / datasets / args に均される', async () => {
  const worker = makeFakeWorker({ run: () => ({ columns: [], rows: [] }) })
  await runAnalysisCode(
    {
      code: 'function analyze() { return {} }',
      dataset: { id: 'main', records: [{ a: 1 }], columns: ['a'], metadata: { title: 'メイン' } },
      datasets: { main: { id: 'main', records: [{ a: 1 }] }, sub: { id: 'sub', records: [{ b: 2 }] } },
      args: { k: 1 },
    },
    options(worker),
  )
  const { input } = worker.calls[0]
  assert.deepEqual(input.records, [{ a: 1 }])
  assert.deepEqual(input.columns, ['a'])
  assert.deepEqual(input.metadata, { datasetId: 'main', title: 'メイン' })
  assert.deepEqual(Object.keys(input.datasets), ['main', 'sub'])
  assert.deepEqual(input.datasets.sub.records, [{ b: 2 }])
  assert.deepEqual(input.args, { k: 1 })
})

test('rejected: 禁止参照と入力上限は Worker を作らずに拒否する', async () => {
  let created = 0
  const createWorker = () => {
    created += 1
    return makeFakeWorker()
  }
  const forbidden = await runAnalysisCode(
    { code: 'function analyze() { return fetch("/x") }' },
    { createWorker, nowFn: () => 0 },
  )
  assert.equal(forbidden.status, 'rejected')
  assert.match(forbidden.error, /禁止された参照/)

  const tooMany = await runAnalysisCode(
    { code: 'function analyze() { return {} }', dataset: { id: 'd', records: [1, 2, 3] } },
    { createWorker, nowFn: () => 0, maxInputRecords: 2 },
  )
  assert.equal(tooMany.status, 'rejected')
  assert.match(tooMany.error, /入力レコードが上限/)
  assert.equal(created, 0)
})

test('error: analyze が無い / 例外 / Worker エラー / 非 JSON / 出力上限', async () => {
  const noAnalyze = await runAnalysisCode({ code: 'const x = 1' }, options(makeFakeWorker()))
  assert.equal(noAnalyze.status, 'error')
  assert.match(noAnalyze.error, /analyze 関数が定義されていません/)

  const thrown = await runAnalysisCode(
    { code: 'function analyze() { throw new Error("失敗") }' },
    options(makeFakeWorker()),
  )
  assert.equal(thrown.status, 'error')
  assert.match(thrown.error, /失敗/)

  const workerError = await runAnalysisCode(
    { code: 'function analyze() { return {} }' },
    options(makeFakeWorker({ error: 'Worker が壊れました' })),
  )
  assert.equal(workerError.status, 'error')
  assert.match(workerError.error, /Worker が壊れました/)

  const circular = makeFakeWorker({
    run: () => {
      const o = { rows: [] }
      o.self = o
      return o
    },
  })
  const notJson = await runAnalysisCode({ code: 'function analyze() { return {} }' }, options(circular))
  assert.equal(notJson.status, 'error')
  assert.match(notJson.error, /JSON 互換ではありません/)

  const big = makeFakeWorker({ run: () => ({ columns: ['a'], rows: [['x'.repeat(200)]] }) })
  const tooBig = await runAnalysisCode(
    { code: 'function analyze() { return {} }' },
    options(big, { maxOutputBytes: 100 }),
  )
  assert.equal(tooBig.status, 'error')
  assert.match(tooBig.error, /出力が上限/)
})

test('timeout: 応答が無ければ timeout を返し Worker を terminate する', async () => {
  const worker = makeFakeWorker({ silent: true })
  const timers = []
  const result = await runAnalysisCode(
    { code: 'function analyze() { while (true) {} }' },
    options(worker, {
      timeoutMs: 1234,
      // タイマーは即発火させる（実時間を待たない）。
      setTimeoutFn: (fn) => {
        timers.push(fn)
        fn()
        return 1
      },
      clearTimeoutFn: () => {},
    }),
  )
  assert.equal(result.status, 'timeout')
  assert.match(result.error, /1234ms/)
  assert.equal(worker.terminated, true)
  assert.equal(timers.length, 1)
})
