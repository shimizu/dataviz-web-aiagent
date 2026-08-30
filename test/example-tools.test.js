// サンプルツール（算術評価・時刻）の単体テスト。
import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_EXPRESSION_LENGTH, evaluateArithmetic } from '../src/tools/example/arithmetic.js'
import { exampleSource } from '../src/tools/example/index.js'
import { ToolRegistry } from '../src/agent/tool-registry.js'

test('算術式: 優先順位・括弧・べき乗（右結合）・単項マイナス・剰余', () => {
  assert.equal(evaluateArithmetic('1 + 2 * 3'), 7)
  assert.equal(evaluateArithmetic('(1+2)*3'), 9)
  assert.equal(evaluateArithmetic('2 ^ 3 ^ 2'), 512)
  assert.equal(evaluateArithmetic('-2 ^ 2'), -4)
  assert.equal(evaluateArithmetic('10 % 4'), 2)
  assert.equal(evaluateArithmetic('(12.5 + 3) * 4'), 62)
  assert.equal(evaluateArithmetic('.5 * 2'), 1)
})

test('算術式: 不正な入力は日本語のエラーで拒否する', () => {
  assert.throws(() => evaluateArithmetic('10 / 0'), /0 で割る/)
  assert.throws(() => evaluateArithmetic('1 + a'), /使えない文字/)
  assert.throws(() => evaluateArithmetic('(1+2'), /閉じ括弧/)
  assert.throws(() => evaluateArithmetic('1 2'), /余分な記号/)
  assert.throws(() => evaluateArithmetic('process.exit()'), /使えない文字/)
  assert.throws(() => evaluateArithmetic(''), /空/)
  assert.throws(() => evaluateArithmetic('1+'.repeat(MAX_EXPRESSION_LENGTH)), /長すぎ/)
})

test('example ソースは registry に 2 ツールを登録し、execute で結果を返す', async () => {
  const registry = new ToolRegistry()
  const logs = []
  exampleSource.register(registry, { log: (m) => logs.push(m), now: () => new Date(Date.UTC(2026, 7, 28, 0, 0, 0)) })
  assert.deepEqual(registry.definitions().map((d) => d.name).sort(), ['calculate', 'get_current_time'])
  assert.ok(exampleSource.skills[0].startsWith('# スキル: サンプルツール'))

  const calc = await registry.execute('calculate', { expression: '365 * 24 * 60 * 60' })
  assert.equal(calc.result, 31536000)

  const time = await registry.execute('get_current_time', { timezone: 'Asia/Tokyo' })
  assert.equal(time.iso, '2026-08-28T00:00:00.000Z')
  assert.equal(time.timezone, 'Asia/Tokyo')
  assert.match(time.formatted, /9:00/)
  assert.ok(logs.length >= 2)

  await assert.rejects(registry.execute('get_current_time', { timezone: 'Mars/Olympus' }), /タイムゾーン名が不正/)
})
