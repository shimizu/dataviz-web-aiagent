// JS 実行ツールソース（登録・定義の切り替え・要約返却）の単体テスト。runAnalysisCode は偽物を注入する。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ToolRegistry } from '../src/agent/tool-registry.js'
import { buildJavascriptToolDefinition, EXECUTE_JAVASCRIPT } from '../src/tools/javascript/definitions.js'
import { LLM_RESULT_ROWS, makeJavascriptHandlers } from '../src/tools/javascript/handlers.js'
import { javascriptSource } from '../src/tools/javascript/index.js'

const successResult = (over = {}) => ({
  status: 'success',
  code: 'function analyze() {}',
  codeHash: 'deadbeef',
  datasetId: null,
  parameters: { args: {} },
  resultColumns: ['a'],
  rows: [[1]],
  warnings: [],
  durationMs: 3,
  computedAt: 'T',
  sourceRecordCount: 0,
  ...over,
})

test('定義: getDataset の有無で datasetId / datasetIds の公開が切り替わる', () => {
  const without = buildJavascriptToolDefinition({ hasDatasets: false })
  assert.equal(without.name, EXECUTE_JAVASCRIPT)
  assert.deepEqual(Object.keys(without.input_schema.properties), ['code', 'args'])
  assert.deepEqual(without.input_schema.required, ['code'])
  assert.match(without.description, /records は空配列/)

  const with_ = buildJavascriptToolDefinition({ hasDatasets: true })
  assert.deepEqual(Object.keys(with_.input_schema.properties), ['code', 'datasetId', 'datasetIds', 'args'])
  assert.match(with_.description, /datasets\[datasetId\]\.records/)
})

test('ソースは registry に execute_javascript を 1 つ登録し、スキルを持つ', async () => {
  const registry = new ToolRegistry()
  const logs = []
  javascriptSource.register(registry, {
    log: (m) => logs.push(m),
    runCode: async () => successResult(),
  })
  assert.deepEqual(registry.definitions().map((d) => d.name), [EXECUTE_JAVASCRIPT])
  assert.equal(javascriptSource.skills.length, 1)
  assert.match(javascriptSource.skills[0], /execute_javascript/)

  const out = await registry.execute(EXECUTE_JAVASCRIPT, { code: 'function analyze() { return {} }' })
  assert.deepEqual(out.rows, [[1]])
  assert.equal(out.codeHash, 'deadbeef')
  assert.equal(logs.length, 1)
  assert.match(logs[0], /deadbeef.*success/)
})

test('datasetId / datasetIds を getDataset で解決して runCode へ渡す', async () => {
  const store = { d1: { id: 'd1', records: [{ a: 1 }] }, d2: { id: 'd2', records: [{ b: 2 }] } }
  let received
  const h = makeJavascriptHandlers({
    getDataset: (id) => store[id] ?? null,
    runCode: async (params) => {
      received = params
      return successResult({ datasetId: params.dataset?.id ?? null, sourceRecordCount: 2 })
    },
  })
  const out = await h.executeJavascript({ code: 'function analyze() { return {} }', datasetId: 'd1', datasetIds: ['d2', 'd2'], args: { k: 1 } })
  assert.equal(received.dataset.id, 'd1')
  // 重複は除き、主データセットは datasets にも入る。
  assert.deepEqual(Object.keys(received.datasets).sort(), ['d1', 'd2'])
  assert.deepEqual(received.args, { k: 1 })
  assert.equal(out.datasetId, 'd1')
  assert.equal(out.sourceRecordCount, 2)
})

test('LLM へ返す行は先頭 20 件までで、truncatedRows と rowCount を添える', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => [i])
  const h = makeJavascriptHandlers({ runCode: async () => successResult({ rows }) })
  const out = await h.executeJavascript({ code: 'function analyze() { return {} }' })
  assert.equal(out.rows.length, LLM_RESULT_ROWS)
  assert.equal(out.rowCount, 25)
  assert.equal(out.truncatedRows, true)
  // コード全文は LLM へ返さない。
  assert.equal(out.code, undefined)
})

test('失敗（rejected / timeout / error）と入力不備は例外にする', async () => {
  const h = makeJavascriptHandlers({ runCode: async () => successResult({ status: 'timeout', error: '5000ms' }) })
  await assert.rejects(() => h.executeJavascript({ code: 'function analyze() {}' }), /timeout.*5000ms/)

  const empty = makeJavascriptHandlers({ runCode: async () => successResult() })
  await assert.rejects(() => empty.executeJavascript({ code: '   ' }), /code が空です/)

  // provider 未注入で datasetId を渡した場合。
  await assert.rejects(
    () => empty.executeJavascript({ code: 'function analyze() {}', datasetId: 'd1' }),
    /データセットを提供していません/,
  )

  const missing = makeJavascriptHandlers({ getDataset: () => null, runCode: async () => successResult() })
  await assert.rejects(
    () => missing.executeJavascript({ code: 'function analyze() {}', datasetId: 'd1' }),
    /データセットが見つかりません: d1/,
  )
})
