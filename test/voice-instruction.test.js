// 音声エージェントの system instruction / 状況スナップショット / 完了通知の単体テスト。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BASE_VOICE_INSTRUCTION,
  buildCompletionNotice,
  buildContextBlock,
  buildContextSnapshot,
  buildVoiceInstruction,
  describeGrounding,
} from '../src/voice/voice-instruction.js'

test('instruction は役割・run_prompt の意味・現在日時・アプリの context を含む', () => {
  const now = new Date(2026, 7, 28, 9, 5)
  const text = buildVoiceInstruction({ context: '## 状況\n- 選択中: item_001', now })
  assert.ok(text.startsWith(BASE_VOICE_INSTRUCTION))
  assert.match(text, /run_prompt/)
  assert.match(text, /そのまま送信・実行/)
  assert.match(text, /【Claude 完了】/)
  assert.match(text, /## 現在日時: 2026-08-28 09:05/)
  assert.match(text, /item_001/)
  assert.ok(!text.includes('capture_map'))
  // context が空なら現在日時だけ
  assert.equal(buildContextBlock({ context: '  ', now }).split('\n\n').length, 1)
  // base の差し替え
  assert.ok(buildVoiceInstruction({ base: 'BASE-X', now }).startsWith('BASE-X'))
})

test('スナップショットは claude_running にアプリの snapshot をマージする', () => {
  assert.deepEqual(buildContextSnapshot({ isAgentRunning: true, snapshot: { items: 2 } }), { claude_running: true, items: 2 })
  assert.deepEqual(buildContextSnapshot(), { claude_running: false })
})

test('完了通知は Markdown を落として短くまとめ、extras を括弧で添える', () => {
  const notice = buildCompletionNotice({ status: 'completed', content: '**完了**: ' + 'あ'.repeat(400), extras: ['追加レイヤー: NDVI', 'チャート 1 件'] })
  assert.match(notice, /^【Claude 完了】/)
  assert.ok(!notice.includes('**'))
  assert.match(notice, /（追加レイヤー: NDVI \/ チャート 1 件）/)
  assert.ok(notice.length < 500)
  assert.match(buildCompletionNotice({ status: 'error', content: 'x' }), /終了: error/)
  assert.ok(!buildCompletionNotice({ status: 'completed', content: 'x' }).includes('（'))
})

test('enableSearch で検索ガイドが入り、groundingMetadata を 1 行にする', () => {
  assert.ok(!buildVoiceInstruction().includes('## Google 検索'))
  assert.match(buildVoiceInstruction({ enableSearch: true }), /## Google 検索/)
  const line = describeGrounding({ webSearchQueries: ['台風 2025'], groundingChunks: [{ web: { title: 'NHK', uri: 'https://nhk' } }] })
  assert.match(line, /検索: 台風 2025/)
  assert.match(line, /出典: NHK/)
  assert.equal(describeGrounding(null), '')
})
