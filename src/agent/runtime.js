// エージェントランタイム（tool use ループの心臓部）。
//
// 役割: Claude の tool use をクライアント側で反復実行する。API 呼び出し（callModel）と
//       ツール実装（toolRegistry）を注入で受け取り、ブラウザ非依存で単体テストできる形に保つ。
// 関係: App が callModel=callClaude、toolRegistry=register-tools のレジストリ、system=
//       composeSystemPrompt(...) を注入。onEvent で進捗（assistant_text）とツール実行ログを発火。
//
// 設計の要点:
//   - stop_reason === "tool_use" の間、ツールを逐次実行し tool_result を会話へ積んでループ。
//     アプリ側のストア状態に依存するため呼び出し順を維持する。
//   - ツール例外は握りつぶさず is_error: true の tool_result として返し、モデルが入力を
//     自己修正して再試行できるようにする（引数の間違い・上限超過等の回収）。
//   - tool_result は一定文字数で打ち切り、巨大な出力で履歴が膨れるのを防ぐ。
//
// 流用元: gee-ai-agent/src/agent/runtime.js（文言を汎用化）
import { compactConversation } from './compaction.js'

const DEFAULT_MAX_ITERATIONS = 30
export const TOOL_RESULT_CHAR_CAP = 8000

const ITERATION_LIMIT_WRAP_UP =
  '反復上限に達し、これ以上ツールは使えません。ここまでに実行したこと・分かったことを簡潔にまとめ、未完了なら残りの手順も示してください。'

function toText(content) {
  return content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

// 大きなツール結果をそのまま LLM へ送るとトークンの無駄になるため一定文字数で打ち切る。
function capToolResultText(text) {
  if (text.length <= TOOL_RESULT_CHAR_CAP) return text
  return `${text.slice(0, TOOL_RESULT_CHAR_CAP)}…（結果が大きいため省略しました。条件を絞って再実行し、必要な部分だけ取得してください）`
}

// ツール結果に _image（{ data, media_type } の base64）があれば、画像 + テキストの content 配列にする。
// 文字数上限はテキスト部にだけ適用する（画像は別枠。モデルが自分の描いた図を見て自己修正するための経路）。
function createToolResult(call, result, isError = false) {
  const image = result && typeof result === 'object' && !Array.isArray(result) ? result._image : null
  let payload = result
  if (image) {
    const { _image, ...rest } = result
    payload = rest
  }
  const text = typeof payload === 'string' ? payload : JSON.stringify(payload ?? null)
  const capped = capToolResultText(text)
  if (image?.data && image?.media_type) {
    return {
      type: 'tool_result',
      tool_use_id: call.id,
      content: [
        { type: 'image', source: { type: 'base64', media_type: image.media_type, data: image.data } },
        { type: 'text', text: capped },
      ],
      ...(isError ? { is_error: true } : {}),
    }
  }
  return {
    type: 'tool_result',
    tool_use_id: call.id,
    content: capped,
    ...(isError ? { is_error: true } : {}),
  }
}

const IMAGE_STRIPPED_NOTE = '（描画結果の画像。過去ターンのため省略）'

// 画像はそのターンで図を確認するためだけに使う。会話ストアは全メッセージを localStorage に永続化するため、
// ターンを跨いで base64 を持ち越すと容量とトークンをすぐ食い潰す。終了時にテキストへ畳む。
export function stripToolResultImages(messages) {
  return messages.map((msg) => {
    if (msg?.role !== 'user' || !Array.isArray(msg.content)) return msg
    let changed = false
    const content = msg.content.map((block) => {
      if (block?.type !== 'tool_result' || !Array.isArray(block.content)) return block
      const texts = block.content.filter((b) => b?.type === 'text').map((b) => b.text)
      if (block.content.length === texts.length) return block
      changed = true
      return { ...block, content: [IMAGE_STRIPPED_NOTE, ...texts].join('\n') }
    })
    return changed ? { ...msg, content } : msg
  })
}

export async function runAgent({
  instruction,
  messages: history = [],
  callModel,
  toolRegistry,
  system,
  maxIterations = DEFAULT_MAX_ITERATIONS,
  signal,
  onEvent = () => {},
}) {
  // 過去履歴を引き継ぎ、古いツール結果は縮約してトークンを抑える。
  const messages = [
    ...compactConversation(history),
    { role: 'user', content: instruction },
  ]

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    if (signal?.aborted) {
      return { status: 'aborted', messages: stripToolResultImages(messages) }
    }

    onEvent({ type: 'model_request', iteration })
    const response = await callModel({
      messages,
      tools: toolRegistry.definitions(),
      system,
      signal,
    })

    messages.push({ role: 'assistant', content: response.content })
    onEvent({ type: 'model_response', iteration, stopReason: response.stop_reason })

    if (response.stop_reason === 'pause_turn') {
      // サーバー側ツールが Anthropic 側の反復上限で中断した状態。履歴のまま再送で継続する。
      const interimText = toText(response.content)
      if (interimText.trim()) {
        onEvent({ type: 'assistant_text', iteration, text: interimText })
      }
      continue
    }

    if (response.stop_reason === 'tool_use') {
      // ツール実行の合間に出るモデルの解説テキストを進行状況として UI へ流す。
      const interimText = toText(response.content)
      if (interimText.trim()) {
        onEvent({ type: 'assistant_text', iteration, text: interimText })
      }

      const calls = response.content.filter((block) => block.type === 'tool_use')
      const results = []

      // ストア状態に依存するツールがあるため、呼び出し順を維持して逐次実行する。
      for (const call of calls) {
        onEvent({ type: 'tool_start', iteration, name: call.name, input: call.input })

        try {
          const result = await toolRegistry.execute(call.name, call.input, { signal })
          results.push(createToolResult(call, result))
          onEvent({ type: 'tool_success', iteration, name: call.name })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          results.push(createToolResult(call, message, true))
          onEvent({ type: 'tool_error', iteration, name: call.name, message })
        }
      }

      messages.push({ role: 'user', content: results })
      continue
    }

    const content = toText(response.content)
    switch (response.stop_reason) {
      case 'end_turn':
        return { status: 'completed', content, messages: stripToolResultImages(messages) }
      case 'max_tokens':
        return { status: 'truncated', content, messages: stripToolResultImages(messages) }
      case 'refusal':
        return { status: 'refused', content, messages: stripToolResultImages(messages) }
      default:
        return { status: 'stopped', reason: response.stop_reason, content, messages: stripToolResultImages(messages) }
    }
  }

  // 反復上限に達したら、ツール無しでもう一度だけ呼んで取得済みの情報で要約回答を作る。
  if (signal?.aborted) {
    return { status: 'aborted', messages: stripToolResultImages(messages) }
  }
  try {
    onEvent({ type: 'model_request', iteration: maxIterations + 1 })
    const response = await callModel({
      messages: [...messages, { role: 'user', content: ITERATION_LIMIT_WRAP_UP }],
      tools: [],
      system,
      signal,
    })
    // ノッジは履歴に残さず、要約の assistant メッセージだけを積む。
    messages.push({ role: 'assistant', content: response.content })
    onEvent({
      type: 'model_response',
      iteration: maxIterations + 1,
      stopReason: response.stop_reason,
    })
    return { status: 'iteration_limit', content: toText(response.content), messages: stripToolResultImages(messages) }
  } catch {
    return { status: 'iteration_limit', messages: stripToolResultImages(messages) }
  }
}
