// サンプルツールの実装。
//
// 役割: get_current_time（Intl でタイムゾーン変換）と calculate（arithmetic.js）の本体。
//       例外はそのまま投げる（runtime.js が is_error の tool_result にしてモデルに自己修正させる）。
// 関係: index.js が deps（log, now）を渡して作る。now はテストで固定するための注入点。
import { evaluateArithmetic } from './arithmetic.js'

export function makeExampleHandlers({ log, now = () => new Date() } = {}) {
  return {
    getCurrentTime({ timezone } = {}) {
      const date = now()
      const tz = String(timezone ?? '').trim()
      let formatter
      try {
        formatter = new Intl.DateTimeFormat('ja-JP', {
          dateStyle: 'full',
          timeStyle: 'long',
          ...(tz ? { timeZone: tz } : {}),
        })
      } catch {
        throw new Error(`タイムゾーン名が不正です: "${tz}"（IANA 名。例: Asia/Tokyo）`)
      }
      const resolved = formatter.resolvedOptions().timeZone
      log?.(`現在時刻を取得（${resolved}）`)
      return { iso: date.toISOString(), formatted: formatter.format(date), timezone: resolved, epochMs: date.getTime() }
    },

    calculate({ expression } = {}) {
      const result = evaluateArithmetic(expression)
      log?.(`計算: ${expression} = ${result}`)
      return { expression: String(expression), result }
    },
  }
}
