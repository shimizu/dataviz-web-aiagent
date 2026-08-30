// 音声セッション（Gemini Live）の結線。
//
// 役割: マイク入力 → Gemini Live → 音声再生の往復を組み立て、Gemini からの UI 操作
//       （run_prompt + アプリ注入の extraTools）をアプリ側の実装へ繋ぐ。Gemini に渡すのはこれらだけで、
//       Claude のツールは渡さない（処理は Claude エージェントの担当）。
//       run_prompt は入力欄に書き込み、そのまま送信して Claude を実行する（実行中は busy で拒否）。
//       Claude の完了は notifyAgentFinished() で受け、要約テキストを送って読み上げさせる。
// 注入: { apiKey, model, isAgentRunning, runPrompt(text), setChatInput, enableSearch, voiceName,
//         buildContext, buildSnapshot, extraTools, log }
//   - buildContext(): string — 接続時に system instruction へ入れる状況（例: 現在のレイヤー一覧）。
//   - buildSnapshot(): object — ツール応答へ同梱する状況（会話中の変化はこれで伝える。sendText は使わない）。
//   - extraTools: [{ declaration, handler(args, { session, log }) }] — アプリ固有の関数（例: 画面のスクショ）。
//     画像を見せる場合は handler 内で session.sendImage() を**先に**呼んでから応答を返す
//     （逆にするとモデルが画像を見ずに話し始める）。戻り値には snapshot が後からマージされる。
//   - enableSearch=true で Google 検索グラウンディングを有効化（groundingMetadata はログに残す）。
// 流用元: gee-ai-agent/src/hooks/useVoiceSession.js（capture_map を extraTools に一般化）
import { useCallback, useEffect, useRef, useState } from 'react'

import { startAudioCapture } from '../voice/audio-capture'
import { createAudioPlayer } from '../voice/audio-player'
import { buildCompletionNotice, buildContextSnapshot, buildVoiceInstruction, describeGrounding } from '../voice/voice-instruction'
import { RUN_PROMPT, buildVoiceTools, dispatchToolCall } from '../voice/voice-tools'

const NO_TOOLS = []

export function useVoiceSession({
  apiKey,
  model,
  isAgentRunning = false,
  runPrompt,
  setChatInput,
  enableSearch = false,
  voiceName,
  buildContext,
  buildSnapshot,
  extraTools = NO_TOOLS,
  log,
} = {}) {
  // idle → connecting → listening ⇄ speaking / error
  const [voiceState, setVoiceState] = useState('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const [elapsed, setElapsed] = useState(0)

  const sessionRef = useRef(null)
  const captureRef = useRef(null)
  const playerRef = useRef(null)
  // 状況系は ref で読む（props の同一性で start / handleToolCall を作り直さない）。
  const contextRef = useRef({ isAgentRunning, buildContext, buildSnapshot, extraTools })
  const stoppingRef = useRef(false)

  useEffect(() => {
    contextRef.current = { isAgentRunning, buildContext, buildSnapshot, extraTools }
  }, [isAgentRunning, buildContext, buildSnapshot, extraTools])

  useEffect(() => {
    if (voiceState !== 'listening' && voiceState !== 'speaking') return undefined
    const timer = setInterval(() => setElapsed((v) => v + 1), 1000)
    return () => clearInterval(timer)
  }, [voiceState])

  const teardown = useCallback(
    async (reason = '') => {
      if (stoppingRef.current) return
      stoppingRef.current = true
      try {
        const capture = captureRef.current
        captureRef.current = null
        if (capture) {
          await capture.stop()
          sessionRef.current?.sendAudioStreamEnd?.()
        }
        sessionRef.current?.close?.()
        sessionRef.current = null
        await playerRef.current?.close?.()
        playerRef.current = null
      } finally {
        stoppingRef.current = false
        setVoiceState((s) => (s === 'error' ? s : 'idle'))
        if (reason) log?.(`🎙 音声セッション終了: ${reason}`)
      }
    },
    [log],
  )

  const fail = useCallback(
    (message) => {
      setError(message)
      setVoiceState('error')
      log?.(`✗ 音声: ${message}`)
      teardown()
    },
    [log, teardown],
  )

  const handleToolCall = useCallback(
    async (toolCall) => {
      const snapshot = () =>
        buildContextSnapshot({
          isAgentRunning: contextRef.current.isAgentRunning,
          snapshot: contextRef.current.buildSnapshot?.() ?? {},
        })
      const handlers = {
        [RUN_PROMPT]: async ({ text }) => {
          const content = String(text ?? '').trim()
          if (!content) throw new Error('text が空です')
          if (contextRef.current.isAgentRunning) {
            log?.('✗ 音声: run_prompt は Claude 実行中のため拒否')
            return { ok: false, busy: true, error: 'Claude エージェントが実行中です。完了の通知を待ってから呼び直してください。', ...snapshot() }
          }
          setChatInput?.(content)
          const started = await runPrompt?.(content)
          if (started === false) {
            return { ok: false, error: 'Claude を実行できません（API キー未設定か実行中）。', ...snapshot() }
          }
          log?.(`✓ 音声: run_prompt → 実行開始（${content.length} 文字）`)
          return {
            ok: true,
            submitted: true,
            note: '指示文を送信し、Claude が実行を開始しました。完了すると「【Claude 完了】」で始まる通知が届きます。',
            ...snapshot(),
          }
        },
      }
      for (const tool of contextRef.current.extraTools ?? []) {
        const name = tool?.declaration?.name
        if (!name || typeof tool.handler !== 'function') continue
        handlers[name] = async (args) => {
          log?.(`▶ 音声: ${name}`)
          const result = await tool.handler(args ?? {}, { session: sessionRef.current, log })
          return { ok: true, ...(result ?? {}), ...snapshot() }
        }
      }
      const responses = await dispatchToolCall(toolCall, handlers)
      const failed = responses.find((r) => r.response?.ok === false && !r.response?.busy)
      if (failed) log?.(`✗ 音声: ${failed.name}: ${failed.response.error}`)
      sessionRef.current?.sendToolResponses(responses)
    },
    [log, runPrompt, setChatInput],
  )

  const start = useCallback(async () => {
    if (sessionRef.current || voiceState === 'connecting') return
    if (!apiKey) {
      fail('Gemini API キーが設定されていません。⚙ 設定 から入力してください。')
      return
    }
    setError('')
    setTranscript('')
    setElapsed(0)
    setVoiceState('connecting')
    try {
      const player = createAudioPlayer({
        onStateChange: (playing) => {
          setVoiceState((s) => (s === 'idle' || s === 'error' ? s : playing ? 'speaking' : 'listening'))
        },
      })
      playerRef.current = player

      const { connectGeminiLive } = await import('../voice/gemini-live-client')
      const extra = contextRef.current.extraTools ?? []
      const session = await connectGeminiLive({
        apiKey,
        model,
        systemInstruction: buildVoiceInstruction({ enableSearch, context: contextRef.current.buildContext?.() ?? '' }),
        enableSearch,
        voiceName,
        tools: buildVoiceTools(extra.map((t) => t.declaration).filter(Boolean)),
        callbacks: {
          onAudio: (base64) => player.enqueue(base64),
          onOutputTranscript: (text) => setTranscript((prev) => `${prev}${text}`),
          onTurnComplete: () => setTranscript((prev) => prev.trim()),
          onInterrupted: () => {
            player.flush()
            setTranscript('')
          },
          onToolCall: (toolCall) => {
            handleToolCall(toolCall).catch((e) => log?.(`✗ 音声ツール: ${String(e?.message ?? e)}`))
          },
          onGrounding: (meta) => {
            const line = describeGrounding(meta)
            if (line) log?.(`🔎 音声: ${line}`)
          },
          onGoAway: (timeLeft) => log?.(`音声セッションはまもなく終了します（残り ${timeLeft}）`),
          onError: (e) => fail(String(e?.message ?? e)),
          onClose: (reason) => teardown(reason || 'サーバーから切断されました'),
        },
      })
      sessionRef.current = session

      const capture = await startAudioCapture({
        onChunk: (base64) => sessionRef.current?.sendAudio(base64, captureRef.current?.sampleRate),
      })
      captureRef.current = capture
      setVoiceState('listening')
      log?.(`🎙 音声セッション開始（${model}, 声: ${voiceName || 'Kore'}${enableSearch ? ', Google 検索あり' : ''}）`)
    } catch (e) {
      const message = String(e?.message ?? e)
      fail(/NotAllowedError|Permission/.test(message) ? 'マイクの使用が許可されませんでした。ブラウザの権限設定を確認してください。' : message)
    }
  }, [apiKey, enableSearch, voiceName, fail, handleToolCall, log, model, teardown, voiceState])

  const stop = useCallback(() => {
    setTranscript('')
    teardown('ユーザー操作で停止')
  }, [teardown])

  // Claude 完了通知 → Gemini にテキストで送って読み上げさせる（セッション中のみ）。
  // result: { status, content, extras?: string[] }
  const notifyAgentFinished = useCallback(
    (result) => {
      const session = sessionRef.current
      if (!session) return
      try {
        session.sendText(buildCompletionNotice(result))
        log?.('🎙 音声: Claude 完了を通知')
      } catch (e) {
        log?.(`✗ 音声: 完了通知失敗: ${String(e?.message ?? e)}`)
      }
    },
    [log],
  )

  useEffect(() => () => void teardown(), [teardown])

  return { voiceState, transcript, error, elapsed, start, stop, notifyAgentFinished, isLive: voiceState === 'listening' || voiceState === 'speaking' }
}
