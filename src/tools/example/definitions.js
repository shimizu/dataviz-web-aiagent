// サンプルツールの定義（Claude へ渡す JSON スキーマ）。
//
// 役割: get_current_time / calculate の名前・説明・input_schema。実装は handlers.js。
// 関係: index.js が registry に登録する。
export const GET_CURRENT_TIME = 'get_current_time'
export const CALCULATE = 'calculate'

export const EXAMPLE_TOOL_DEFINITIONS = [
  {
    name: GET_CURRENT_TIME,
    description:
      '現在日時を返す。timezone（IANA 名。例: Asia/Tokyo, America/New_York）を省略するとブラウザのローカル時刻。' +
      '「今何時」「ニューヨークは今何時」など時刻の質問に使う。',
    input_schema: {
      type: 'object',
      properties: {
        timezone: { type: 'string', description: 'IANA タイムゾーン名（省略時はローカル）' },
      },
    },
  },
  {
    name: CALCULATE,
    description:
      '算術式を安全に評価して数値を返す。使えるのは数値と + - * / % ^ ( ) だけ（^ はべき乗、右結合）。' +
      '暗算で済ませず、数値を答えるときは必ずこのツールの結果を根拠にする。',
    input_schema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: '例: "(12.5 + 3) * 4", "2 ^ 10", "365 * 24 * 60 * 60"' },
      },
      required: ['expression'],
    },
  },
]
