// 音声エージェントへ公開する関数宣言とディスパッチの単体テスト。
import test from 'node:test'
import assert from 'node:assert/strict'
import { RUN_PROMPT, RUN_PROMPT_DECLARATION, VOICE_FUNCTION_DECLARATIONS, VOICE_TOOLS, buildVoiceTools, dispatchToolCall } from '../src/voice/voice-tools.js'

test('固定で公開するのは run_prompt だけ（Claude のツールは含まない）', () => {
  const names = VOICE_FUNCTION_DECLARATIONS.map((d) => d.name)
  assert.deepEqual(names, [RUN_PROMPT])
  for (const forbidden of ['calculate', 'get_current_time', 'ee_run', 'show_chart']) {
    assert.ok(!names.includes(forbidden))
  }
  assert.deepEqual(VOICE_TOOLS, [{ functionDeclarations: VOICE_FUNCTION_DECLARATIONS }])
})

test('buildVoiceTools はアプリの宣言を run_prompt の後ろに足す', () => {
  const capture = { name: 'capture_view', description: '画面を見る', parameters: { type: 'OBJECT', properties: {} } }
  assert.deepEqual(buildVoiceTools([capture]), [{ functionDeclarations: [RUN_PROMPT_DECLARATION, capture] }])
  assert.deepEqual(buildVoiceTools(), VOICE_TOOLS)
})

test('run_prompt は text 必須で「送信・実行」まで行うと宣言している', () => {
  assert.deepEqual(RUN_PROMPT_DECLARATION.parameters.required, ['text'])
  assert.match(RUN_PROMPT_DECLARATION.description, /送信/)
  assert.match(RUN_PROMPT_DECLARATION.description, /busy/)
})

test('dispatch は id/name を保ち、未対応・text 欠落は ok:false', async () => {
  const responses = await dispatchToolCall(
    { functionCalls: [{ id: 'c1', name: RUN_PROMPT, args: { text: '1 年は何秒？' } }, { id: 'c2', name: 'nope', args: {} }, { id: 'c3', name: RUN_PROMPT, args: {} }] },
    { [RUN_PROMPT]: async ({ text }) => ({ ok: true, submitted: true, chars: text.length }) },
  )
  assert.deepEqual(responses[0], { id: 'c1', name: RUN_PROMPT, response: { ok: true, submitted: true, chars: 7 } })
  assert.equal(responses[1].response.ok, false)
  assert.match(responses[2].response.error, /text/)
})
