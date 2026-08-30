// 音声エージェント（Gemini Live）へ公開する関数宣言とディスパッチ（純関数・ブラウザ非依存）。
//
// 役割: Gemini に渡す functionDeclarations の定義と、toolCall を実装へ振り分ける処理を持つ。
//       シェルが固定で公開するのは run_prompt（Claude エージェントへの指示文を入力して送信まで行う）だけ。
//       アプリ固有の「画面を見る」系（例: 地図のスクリーンショット）は buildVoiceTools(extra) で後ろに足す。
//       Claude のツール（分析・データ取得）は一切渡さない（実行は Claude エージェントの担当）。
// 関係: useVoiceSession がハンドラ（入力欄への書き込み＋送信、アプリ注入の extraTools）を渡して使う。
//       例外を投げずに { ok:false, error } を返すのは runtime.js と同じ方針。
// 流用元: gee-ai-agent/src/voice/voice-tools.js（capture_map を注入式に一般化）

export const RUN_PROMPT = 'run_prompt'

export const RUN_PROMPT_DECLARATION = {
  name: RUN_PROMPT,
  description:
    'Claude エージェントへの指示文をプロンプト入力欄に書き込み、そのまま送信して実行を開始する。' +
    'Claude が実行中のときは拒否される（ok:false, busy:true）ので、完了を待ってから呼び直す。' +
    '実行が完了すると結果の要約がテキストで届くので、それを短くユーザーに伝える。',
  parameters: {
    type: 'OBJECT',
    properties: {
      text: {
        type: 'STRING',
        description:
          'Claude エージェントへ渡す指示文の全文。日本語で、対象・処理内容・欲しい出力が分かるように自己完結させる。' +
          '会話の相槌は入れない。',
      },
    },
    required: ['text'],
  },
}

export const VOICE_FUNCTION_DECLARATIONS = [RUN_PROMPT_DECLARATION]

export const VOICE_TOOLS = [{ functionDeclarations: VOICE_FUNCTION_DECLARATIONS }]

// アプリ固有の宣言（例: capture_map）を run_prompt の後ろに足した tools を作る。
export function buildVoiceTools(extraDeclarations = []) {
  return [{ functionDeclarations: [...VOICE_FUNCTION_DECLARATIONS, ...extraDeclarations] }]
}

export async function dispatchFunctionCall(call, handlers = {}) {
  const { id, name, args } = call ?? {}
  try {
    const handler = handlers[name]
    if (!handler) throw new Error(`未対応の関数です: ${name}`)
    if (name === RUN_PROMPT && typeof args?.text !== 'string') throw new Error('text が指定されていません')
    const response = await handler(args ?? {})
    return { id, name, response: response ?? { ok: true } }
  } catch (e) {
    return { id, name, response: { ok: false, error: String(e?.message ?? e) } }
  }
}

// gemini-3.1-flash-live-preview は非同期 function calling 非対応のため逐次で回す。
export async function dispatchToolCall(toolCall, handlers) {
  const calls = toolCall?.functionCalls ?? []
  const responses = []
  for (const call of calls) responses.push(await dispatchFunctionCall(call, handlers))
  return responses
}
