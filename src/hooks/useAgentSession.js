// エージェント（チャット）セッションの結線。
//
// 役割: チャット状態（messages / isRunning / chatInput）と会話永続化（ConversationStore）を所有し、
//       runAgent へ callClaude / toolRegistry / system を注入して実行する。onEvent で
//       「途中経過→チャット」「ツール実行→ログ」を出し分ける。ツールからの postChatMessage
//       （任意 kind のメッセージ。表示は ChatPanel の renderMessage で拡張）もここで受ける。
//       onFinished で実行完了（status/本文）を通知する（音声読み上げ用）。
// 注入: { deps, buildSystem, apiKey, model, maxTokens, log, onFinished }
//   - deps: ツールソースへ渡すアプリ固有の依存（ストア・コールバック等）。**参照安定であること**
//     （registry を deps でメモ化しているため。App では useMemo で作る）。
//   - buildSystem(): runAgent の system ブロック配列を毎ターン作る。省略時は BASE+スキルのみ。
//     揮発情報（現在の状態）は agent/system-context.js の buildSystemBlocks({ contextParts }) で足す。
// 流用元: gee-ai-agent/src/hooks/useAgentSession.js（ドメイン依存を deps / buildSystem に集約）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { runAgent } from '../agent/runtime'
import { callClaude } from '../agent/claude-client'
import { composeSystemPrompt } from '../agent/system-prompt'
import { buildSystemBlocks } from '../agent/system-context.js'
import { ConversationStore } from '../agent/conversation-store'
import { createToolRegistry } from '../tools/register-tools'
import { SOURCES } from '../tools/sources.js'
import { storageKey } from '../data/settings.js'
import { uuid } from '../utils/ids.js'

const conversationStore = new ConversationStore({ storageKey: storageKey('conversation') })
const DEFAULT_SYSTEM_PROMPT = composeSystemPrompt({ skills: SOURCES.flatMap((s) => s.skills ?? []) })
const agentSession = { originPrompt: '' }
const CHAT_VIEW_STORAGE = storageKey('chat-view')

function loadChatView() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(CHAT_VIEW_STORAGE) ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function shortInput(input) {
  try {
    const s = JSON.stringify(input)
    return s.length > 100 ? `${s.slice(0, 100)}…` : s
  } catch {
    return ''
  }
}

const EMPTY_DEPS = {}

export function useAgentSession({ deps = EMPTY_DEPS, buildSystem, apiKey, model, maxTokens, log, onFinished }) {
  const [messages, setMessages] = useState(loadChatView)
  const [isRunning, setIsRunning] = useState(false)
  const abortRef = useRef(null)
  const [chatInput, setChatInput] = useState('')
  const chatInputRef = useRef(null)

  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(CHAT_VIEW_STORAGE, JSON.stringify(messages))
    } catch {
      // 容量超過などでも現在の画面上の会話は継続する。
    }
  }, [messages])

  const postChatMessage = useCallback((message) => {
    setMessages((cur) => [...cur, { id: uuid(), role: 'assistant', ...message }])
  }, [])

  const toolRegistry = useMemo(
    () => createToolRegistry({ ...deps, postChatMessage, session: agentSession, log }),
    [deps, postChatMessage, log],
  )

  const handleSubmit = useCallback(
    async (content) => {
      if (!apiKey || isRunning) return false
      setMessages((cur) => [...cur, { id: uuid(), role: 'user', content }])
      setIsRunning(true)
      const controller = new AbortController()
      abortRef.current = controller
      agentSession.originPrompt = content
      try {
        const result = await runAgent({
          instruction: content,
          messages: conversationStore.getMessages(),
          toolRegistry,
          system: buildSystem ? buildSystem() : buildSystemBlocks({ systemPrompt: DEFAULT_SYSTEM_PROMPT }),
          signal: controller.signal,
          callModel: (req) => callClaude({ ...req, apiKey, model, maxTokens }),
          onEvent: (event) => {
            if (event.type === 'assistant_text') {
              setMessages((cur) => [...cur, { id: uuid(), role: 'assistant', kind: 'progress', content: event.text }])
            } else if (event.type === 'tool_start') {
              log(`▶ ${event.name} ${shortInput(event.input)}`)
            } else if (event.type === 'tool_success') {
              log(`✓ ${event.name}`)
            } else if (event.type === 'tool_error') {
              log(`✗ ${event.name}: ${event.message}`)
            }
          },
        })
        conversationStore.setMessages(result.messages)
        // 音声セッションなどへ完了を通知。
        try {
          onFinished?.({ status: result.status, content: result.content ?? '' })
        } catch {
          // 通知失敗は無視
        }
        if (result.content && result.status !== 'aborted' && result.status !== 'refused') {
          setMessages((cur) => [...cur, { id: uuid(), role: 'assistant', content: result.content }])
        } else if (result.status === 'aborted') {
          setMessages((cur) => [...cur, { id: uuid(), role: 'assistant', kind: 'notice', content: '中断しました。' }])
        } else if (result.status === 'refused') {
          setMessages((cur) => [...cur, { id: uuid(), role: 'assistant', kind: 'notice', content: '回答が拒否されました。' }])
        }
      } catch (e) {
        setMessages((cur) => [
          ...cur,
          { id: uuid(), role: 'assistant', kind: 'notice', content: `エラー: ${String(e?.message ?? e)}` },
        ])
        try {
          onFinished?.({ status: 'error', content: String(e?.message ?? e) })
        } catch {
          // 無視
        }
      } finally {
        setIsRunning(false)
        abortRef.current = null
      }
      return true
    },
    [apiKey, isRunning, toolRegistry, buildSystem, model, maxTokens, log, onFinished],
  )

  const handleAbort = useCallback(() => abortRef.current?.abort(), [])
  const handleResetChat = useCallback(() => {
    conversationStore.clear()
    setMessages([])
    setChatInput('')
    try {
      globalThis.localStorage?.removeItem(CHAT_VIEW_STORAGE)
    } catch {
      // 無視
    }
  }, [])

  return {
    messages,
    isRunning,
    chatInput,
    setChatInput,
    chatInputRef,
    handleSubmit,
    handleAbort,
    handleResetChat,
    postChatMessage,
  }
}
