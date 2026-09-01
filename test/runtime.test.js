// runAgent（tool use ループ）の単体テスト。
// callModel と toolRegistry を注入し、ブラウザ非依存で挙動を検証する。
import test from 'node:test'
import assert from 'node:assert/strict'

import { runAgent } from '../src/agent/runtime.js'
import { ToolRegistry } from '../src/agent/tool-registry.js'

test('ツールを使わない応答を completed として返す', async () => {
  const result = await runAgent({
    instruction: '東京の境界を表示して',
    toolRegistry: new ToolRegistry(),
    callModel: async () => ({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: '完了しました。' }],
    }),
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.content, '完了しました。')
})

test('tool use の結果を会話へ積んで次の応答へ進む', async () => {
  const registry = new ToolRegistry().register(
    { name: 'run_spatial_sql', description: '', input_schema: { type: 'object' } },
    async ({ layer_name }) => ({ layerId: layer_name, featureCount: 1 }),
  )

  let calls = 0
  const result = await runAgent({
    instruction: 'バッファを作って',
    toolRegistry: registry,
    callModel: async ({ messages }) => {
      calls += 1
      if (calls === 1) {
        return {
          stop_reason: 'tool_use',
          content: [
            {
              type: 'tool_use',
              id: 'tool-1',
              name: 'run_spatial_sql',
              input: { sql: 'SELECT ...', layer_name: 'buf' },
            },
          ],
        }
      }
      // 2 回目: 直前に tool_result が積まれている。
      const last = messages.at(-1)
      assert.equal(last.role, 'user')
      assert.equal(last.content[0].type, 'tool_result')
      assert.equal(last.content[0].tool_use_id, 'tool-1')
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: '作成しました。' }] }
    },
  })

  assert.equal(calls, 2)
  assert.equal(result.status, 'completed')
})

test('ツール例外は is_error の tool_result としてモデルへ返り、ループは継続する', async () => {
  const registry = new ToolRegistry().register(
    { name: 'run_spatial_sql', description: '', input_schema: { type: 'object' } },
    async () => {
      throw new Error('CRS 不一致')
    },
  )

  let sawError = false
  const result = await runAgent({
    instruction: 'x',
    toolRegistry: registry,
    callModel: async ({ messages }) => {
      const last = messages.at(-1)
      if (last.role === 'user' && Array.isArray(last.content) && last.content[0]?.is_error) {
        sawError = true
        assert.match(last.content[0].content, /CRS 不一致/)
        return { stop_reason: 'end_turn', content: [{ type: 'text', text: '修正します。' }] }
      }
      return {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 't1', name: 'run_spatial_sql', input: {} }],
      }
    },
  })

  assert.equal(sawError, true)
  assert.equal(result.status, 'completed')
})

test('中断シグナルで aborted を返す', async () => {
  const controller = new AbortController()
  controller.abort()
  const result = await runAgent({
    instruction: 'x',
    toolRegistry: new ToolRegistry(),
    signal: controller.signal,
    callModel: async () => {
      throw new Error('呼ばれないはず')
    },
  })
  assert.equal(result.status, 'aborted')
})

test('_image 付きのツール結果は画像 + テキストの content 配列になり、終了時に画像はテキストへ畳まれる', async () => {
  const registry = new ToolRegistry().register(
    { name: 'render_visualization', description: '', input_schema: { type: 'object' } },
    async () => ({ vizId: 'viz_001', _image: { data: 'QUJD', media_type: 'image/png' } }),
  )

  let midRun
  let calls = 0
  const result = await runAgent({
    instruction: '描いて',
    toolRegistry: registry,
    callModel: async ({ messages }) => {
      calls += 1
      if (calls === 1) {
        return {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'render_visualization', input: {} }],
        }
      }
      midRun = messages.at(-1).content[0]
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: '描きました。' }] }
    },
  })

  // ループ中: 画像 + テキストの配列。テキスト側に要約 JSON、_image キーは含まれない。
  assert.equal(midRun.type, 'tool_result')
  assert.equal(midRun.content[0].type, 'image')
  assert.deepEqual(midRun.content[0].source, { type: 'base64', media_type: 'image/png', data: 'QUJD' })
  assert.equal(midRun.content[1].type, 'text')
  assert.match(midRun.content[1].text, /viz_001/)
  assert.ok(!midRun.content[1].text.includes('_image'))

  // 終了後: 返る messages では画像がテキストのプレースホルダに畳まれている（localStorage 永続化のため）。
  const stored = result.messages.find((m) => m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'tool_result')
  assert.equal(typeof stored.content[0].content, 'string')
  assert.match(stored.content[0].content, /画像/)
  assert.match(stored.content[0].content, /viz_001/)
})

test('_image が無い結果は従来どおり文字列 content になり、cap はテキストにだけ効く', async () => {
  const registry = new ToolRegistry().register(
    { name: 'big', description: '', input_schema: { type: 'object' } },
    async () => ({ text: 'あ'.repeat(9000), _image: { data: 'QUJD', media_type: 'image/png' } }),
  )
  let midRun
  let calls = 0
  await runAgent({
    instruction: 'x',
    toolRegistry: registry,
    callModel: async ({ messages }) => {
      calls += 1
      if (calls === 1) {
        return { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'big', input: {} }] }
      }
      midRun = messages.at(-1).content[0]
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] }
    },
  })
  assert.equal(midRun.content[0].type, 'image', '画像は cap の対象外')
  assert.ok(midRun.content[1].text.length < 9000, 'テキスト部は cap される')
  assert.match(midRun.content[1].text, /省略しました/)
})

test('compactConversation は画像入り tool_result（配列 content）もプレースホルダへ置換する', async () => {
  const { compactConversation } = await import('../src/agent/compaction.js')
  const messages = [
    { role: 'user', content: '描いて' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'render', input: {} }] },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 't1',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
            { type: 'text', text: '{"vizId":"viz_001"}' },
          ],
        },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: '描きました。' }] },
    // 直近保持数（8 件）の外へ画像メッセージを追い出すための埋めターン
    ...Array.from({ length: 5 }, (_, i) => [
      { role: 'user', content: `質問${i}` },
      { role: 'assistant', content: [{ type: 'text', text: `回答${i}` }] },
    ]).flat(),
  ]
  const compacted = compactConversation(messages)
  const block = compacted[2].content[0]
  assert.equal(block.type, 'tool_result')
  assert.equal(typeof block.content, 'string', '画像入りの配列 content も文字列プレースホルダになる')
})
