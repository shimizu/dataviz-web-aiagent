// 会話コンパクションの単体テスト。
import test from 'node:test'
import assert from 'node:assert/strict'
import { COMPACT_PLACEHOLDER, compactConversation } from '../src/agent/compaction.js'

const toolTurn = (i) => [
  { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'calculate', input: { expression: '1+1' } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: `result ${i}` }] },
]

test('直近 N 件は残し、それより古い tool_result の本文だけをプレースホルダにする', () => {
  const messages = [{ role: 'user', content: 'hi' }, ...Array.from({ length: 5 }, (_, i) => toolTurn(i)).flat()]
  const out = compactConversation(messages, { keepRecentMessages: 4 })
  assert.equal(out.length, messages.length)
  assert.equal(out[0].content, 'hi')
  assert.equal(out[2].content[0].content, COMPACT_PLACEHOLDER)
  assert.equal(out[2].content[0].tool_use_id, 't0')
  assert.equal(out[1].content[0].type, 'tool_use')
  assert.equal(out.at(-1).content[0].content, 'result 4')
  assert.ok(!COMPACT_PLACEHOLDER.includes('list_layers'))
})

test('閾値以下なら同じ配列を返し、placeholder は差し替えられる', () => {
  const messages = toolTurn(0)
  assert.equal(compactConversation(messages), messages)
  const out = compactConversation([...toolTurn(0), ...toolTurn(1), ...toolTurn(2)], { keepRecentMessages: 2, placeholder: 'X' })
  assert.equal(out[1].content[0].content, 'X')
})
