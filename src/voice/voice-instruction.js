// 音声エージェント（Gemini Live）の system instruction 組み立て（純関数・ブラウザ非依存）。
//
// 役割: Gemini に「自分は処理を実行せず、ユーザーと会話して Claude への指示文を作り、run_prompt で
//       実行を依頼する相棒だ」と伝える文面を作る。アプリ固有の状況（context）は文字列で受け取る。
// 関係: useVoiceSession が接続時に渡す。会話中の変化は buildContextSnapshot() をツール応答へ同梱し、
//       Claude の完了は buildCompletionNotice() をテキストで送って読み上げさせる。
// 流用元: gee-ai-agent/src/voice/voice-instruction.js（GEE / 地図の記述を外し、context を注入式に）
export const BASE_VOICE_INSTRUCTION = `あなたはこのアプリの音声アシスタントです。

## このアプリについて
- ブラウザだけで動くアシスタントです。実際の処理を行うのは内蔵の **Claude エージェント**で、自然言語の指示からツールを使って調べ・計算し、結果をチャットに返します。
- Claude ができることは、下の「状況」やアプリの説明に書かれているツールの範囲です。

## あなたの役割
- あなた自身は処理を実行しません。**ユーザーと会話して Claude への指示文をまとめ、run_prompt で実行を依頼する**のが仕事です。
- やりたいことが曖昧なときは、対象・条件・欲しい出力が埋まるまで質問してください。十分に具体的なら、すぐ run_prompt を呼んでかまいません。
- run_prompt を呼ぶと入力欄に書き込まれて**そのまま送信・実行されます**。呼んだら「実行を依頼しました。少しお待ちください」と短く伝えてください。
- Claude が実行中に run_prompt を呼ぶと busy で拒否されます。
- Claude の実行が完了するまでユーザーのサポートをしてください。
- もし翻訳を指示された場合はユーザーの言葉を英語で復唱してください。
- Claude の実行が完了すると、結果の要約が「【Claude 完了】」で始まるテキストで届きます。それを 1〜2 文で噛み砕いてユーザーに伝えてください。
- 名前や ID は下の状況にあるものをそのまま使ってください。

## 話し方
- 日本語で話します。
- 音声なので短く、1 度に 1 つだけ質問します。長い説明や箇条書きの読み上げは避けてください。
- 専門用語は噛み砕いて説明します。数値は単位を添えます。`

export function formatVoiceNow(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 現在日時 + アプリが渡す状況（文字列。例: 「## 現在のレイヤー\n- ...」）。
export function buildContextBlock({ context = '', now = new Date() } = {}) {
  const blocks = [
    `## 現在日時: ${formatVoiceNow(now)}（ユーザーの言う「今年」「先月」はこれを基準にし、日付が未来か過去かを自分の知識で判断しない）`,
  ]
  const extra = String(context ?? '').trim()
  if (extra) blocks.push(extra)
  return blocks.join('\n\n')
}

const SEARCH_GUIDE = `## Google 検索
- 最近の出来事の日付や場所、固有名詞の正確な表記が曖昧なときは、指示文を作る前に Google 検索で確認してください。
- 検索結果は指示文を具体的にするためだけに使い、数値や分析結果は Claude の結果（【Claude 完了】の通知）だけを根拠にしてください。
- 検索したことは一言添える程度にし、URL は読み上げないでください。`

export function buildVoiceInstruction({ enableSearch = false, context = '', base = BASE_VOICE_INSTRUCTION, now = new Date() } = {}) {
  const blocks = [base]
  if (enableSearch) blocks.push(SEARCH_GUIDE)
  blocks.push(buildContextBlock({ context, now }))
  return blocks.join('\n\n')
}

// groundingMetadata → ログ用の 1 行（検索語と出典ドメイン）。
export function describeGrounding(meta) {
  if (!meta) return ''
  const queries = Array.isArray(meta.webSearchQueries) ? meta.webSearchQueries : []
  const sources = (meta.groundingChunks ?? [])
    .map((c) => c?.web?.title || c?.web?.uri || '')
    .filter(Boolean)
    .slice(0, 3)
  const parts = []
  if (queries.length) parts.push(`検索: ${queries.slice(0, 3).join(' / ')}`)
  if (sources.length) parts.push(`出典: ${sources.join(', ')}`)
  return parts.join(' ')
}

// ツール応答へ同梱する現在の状況。snapshot はアプリが渡す任意のオブジェクト（例: { layers: [...] }）。
export function buildContextSnapshot({ isAgentRunning = false, snapshot = {} } = {}) {
  return { claude_running: isAgentRunning, ...(snapshot ?? {}) }
}

// Claude 完了時に Gemini へ送るテキスト（読み上げ用。短く）。extras はアプリが足す補足（例: 「追加レイヤー: NDVI」）。
export function buildCompletionNotice({ status, content = '', extras = [], maxChars = 300 } = {}) {
  const head = status === 'completed' ? '【Claude 完了】' : `【Claude 終了: ${status}】`
  const summary = String(content ?? '')
    .replace(/[#*`>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const body = summary.length > maxChars ? `${summary.slice(0, maxChars)}…` : summary || '（本文なし）'
  const notes = (extras ?? []).map((e) => String(e ?? '').trim()).filter(Boolean)
  return `${head} ${body}${notes.length ? `（${notes.join(' / ')}）` : ''} これを 1〜2 文で要約してユーザーに伝え、次に何をするか聞いてください。`
}
