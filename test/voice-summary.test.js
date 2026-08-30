import test from 'node:test'
import assert from 'node:assert/strict'

import { buildFinishedExtras, buildVoiceContextText, buildVoiceSnapshotData } from '../src/viz/voice-summary.js'
import { buildCompletionNotice, buildContextSnapshot, buildVoiceInstruction } from '../src/voice/voice-instruction.js'

const DATASETS = [
  { id: 'ds_001', name: 'sales.csv', kind: 'tabular', rowCount: 6, columns: [{ name: 'v' }, { name: 'w' }] },
  { id: 'ds_002', name: 'pref.geojson', kind: 'geojson', featureCount: 2, geometryTypes: ['Polygon'] },
]
const VIZ = { id: 'viz_001', title: '都市別の売上', description: '2 月の合計' }
const VERSION = { version: 2, svg: '<svg/>', width: 720, height: 420 }

test('buildVoiceContextText はアプリの説明・データ一覧・現在の可視化を含む', () => {
  const text = buildVoiceContextText({ datasets: DATASETS, viz: VIZ, version: VERSION })
  assert.match(text, /## このアプリ/)
  assert.match(text, /run_prompt に渡す指示文/)
  assert.match(text, /look_at_visualization/)
  assert.match(text, /## 読み込み済みデータセット/)
  assert.match(text, /ds_001: sales\.csv（表・6 行 × 2 列）/)
  assert.match(text, /ds_002: pref\.geojson（GeoJSON・2 地物・Polygon）/)
  assert.match(text, /## 現在の可視化\nviz_001 v2「都市別の売上」（2 月の合計）/)
})

test('buildVoiceContextText はデータや可視化が無いときに案内を出す', () => {
  const empty = buildVoiceContextText({})
  assert.match(empty, /まだありません。画面左の「データ」タブに/)
  assert.match(empty, /## 現在の可視化\nまだありません。/)
  const noDescription = buildVoiceContextText({ datasets: DATASETS, viz: { id: 'viz_002', title: 'x' }, version: null })
  assert.match(noDescription, /viz_002 v\?「x」$/m)
})

test('buildVoiceSnapshotData は軽い要約で、claude_running と衝突しない', () => {
  const snapshot = buildVoiceSnapshotData({ datasets: DATASETS, viz: VIZ, version: VERSION })
  assert.deepEqual(snapshot, {
    datasets: [
      { id: 'ds_001', name: 'sales.csv', kind: 'tabular' },
      { id: 'ds_002', name: 'pref.geojson', kind: 'geojson' },
    ],
    visualization: { id: 'viz_001', title: '都市別の売上', version: 2 },
  })
  assert.equal('claude_running' in snapshot, false)
  assert.deepEqual(buildVoiceSnapshotData({}), { datasets: [], visualization: null })
  // ツール応答へのマージ（useVoiceSession と同じ形）で状態が壊れないこと
  const merged = buildContextSnapshot({ isAgentRunning: true, snapshot })
  assert.equal(merged.claude_running, true)
  assert.equal(merged.visualization.id, 'viz_001')
})

test('buildFinishedExtras は完了通知に現在の可視化を添える', () => {
  assert.equal(buildFinishedExtras({ viz: VIZ, version: VERSION }), '可視化 viz_001 v2「都市別の売上」を表示中です。')
  assert.equal(buildFinishedExtras({}), '')
  const notice = buildCompletionNotice({ status: 'completed', content: '棒グラフを作りました', extras: [buildFinishedExtras({ viz: VIZ, version: VERSION })] })
  assert.match(notice, /【Claude 完了】 棒グラフを作りました（可視化 viz_001 v2「都市別の売上」を表示中です。）/)
})

test('接続時の指示文にアプリの状況が入る', () => {
  const instruction = buildVoiceInstruction({ context: buildVoiceContextText({ datasets: DATASETS, viz: VIZ, version: VERSION }), now: new Date(Date.UTC(2026, 0, 2)) })
  assert.match(instruction, /あなたはこのアプリの音声アシスタントです/)
  assert.match(instruction, /## 現在日時: 2026-01-/)
  assert.match(instruction, /ds_001: sales\.csv/)
})
