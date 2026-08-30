// system プロンプトのブロック組み立て（純関数・テスト対象）。
//
// 役割: 安定プレフィックス（BASE+スキル, cache_control）と、毎ターン変わる揮発ブロック
//       （現在日時 + アプリが注入する contextParts）を別ブロックにして返す。
//       プロンプトキャッシュはプレフィックス一致で効くため、揮発部分を安定部分に混ぜない。
// 関係: hooks/useAgentSession.js が runAgent の system として渡す。App が buildSystem で
//       contextParts（例: 現在のレイヤー一覧・選択中のデータ）を差し込む。
import { composeSystemPrompt } from './system-prompt.js'

// アクセス時の現在日時（年月日 時:分、曜日、タイムゾーン）。毎ターン評価する。
export function formatNow(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const y = date.getFullYear()
  const m = pad(date.getMonth() + 1)
  const d = pad(date.getDate())
  const hh = pad(date.getHours())
  const mm = pad(date.getMinutes())
  const dow = ['日', '月', '火', '水', '木', '金', '土'][date.getDay()]
  const tz = -date.getTimezoneOffset() / 60
  return `${y}-${m}-${d}（${dow}）${hh}:${mm} ローカル時刻（UTC${tz >= 0 ? '+' : ''}${tz}）`
}

// contextParts: 文字列または () => string。空文字 / null は捨てる。関数は毎ターン評価する。
export function buildSystemBlocks({ systemPrompt = composeSystemPrompt(), contextParts = [], now = new Date() } = {}) {
  const blocks = [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }]
  const parts = [
    `## 現在日時\n${formatNow(now)}。ユーザーの指定する日付・期間はこの日時を基準に解釈し、学習時点の知識で未来/過去を判断しない。`,
  ]
  for (const part of contextParts ?? []) {
    const text = typeof part === 'function' ? part() : part
    const trimmed = String(text ?? '').trim()
    if (trimmed) parts.push(trimmed)
  }
  blocks.push({ type: 'text', text: parts.join('\n\n'), cache_control: { type: 'ephemeral' } })
  return blocks
}
