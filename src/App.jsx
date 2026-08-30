// アプリの唯一の結線点。
//
// 役割: 設定・エージェント（Claude）・音声（Gemini Live）の各フックを依存順に結線する。
//       UI コンポーネントは表示と入力のみを担い、推論・ツール実行は agent/* ・tools/* のモジュールが行う。
//       ドメインを足すときは、ここで deps / buildSystem(contextParts) / 音声の extraTools・buildContext・
//       buildSnapshot / ChatPanel の renderMessage / Header の leftSlot / .workspace-main の中身を差し込む。
// 関係: hooks/*（結線フック）、components/*。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useSettings } from './hooks/useSettings'
import { useAgentSession } from './hooks/useAgentSession'
import { useVoiceSession } from './hooks/useVoiceSession'
import { useVisualViewport } from './hooks/useVisualViewport'

import { composeSystemPrompt } from './agent/system-prompt.js'
import { buildSystemBlocks } from './agent/system-context.js'
import { SOURCES } from './tools/sources.js'
import { loadSetting, saveSetting, SETTINGS_KEYS, storageKey } from './data/settings.js'
import { uuid } from './utils/ids.js'

import Header from './components/Header'
import ApiSettings from './components/ApiSettings'
import Sidebar from './components/Sidebar'
import TabbedPanel from './components/TabbedPanel'
import ChatPanel from './components/ChatPanel'
import VoiceButton from './components/VoiceButton'
import ExecutionLog from './components/ExecutionLog'
import AboutModal from './components/AboutModal'

import './styles/app.css'

const LOG_STORAGE = storageKey('operation-log')
// 安定プレフィックス（BASE + 全ソースのスキル）。プロンプトキャッシュの対象なので揮発情報を混ぜない。
const SYSTEM_PROMPT = composeSystemPrompt({ skills: SOURCES.flatMap((s) => s.skills ?? []) })

function loadLogs() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(LOG_STORAGE) ?? '[]')
    return Array.isArray(parsed) ? parsed.slice(-300) : []
  } catch {
    return []
  }
}

function App() {
  // --- ログ ---
  const [logs, setLogs] = useState(loadLogs)
  const log = useCallback((message) => {
    setLogs((cur) => [...cur, { id: uuid(), message: `${new Date().toLocaleTimeString('ja-JP')} ${message}` }].slice(-300))
  }, [])
  useEffect(() => {
    try {
      globalThis.localStorage?.setItem(LOG_STORAGE, JSON.stringify(logs))
    } catch {
      // 無視
    }
  }, [logs])

  // --- 設定 ---
  const { settings, setField, save, deleteKeys, settingsOpen, setSettingsOpen, tests, testClaude, testGemini } = useSettings()
  // スマホで実際に見えている高さに .app-shell を合わせる（100vh/100dvh の揺れ対策）。
  const viewportBox = useVisualViewport()
  const shellStyle = viewportBox ? { height: `${viewportBox.height}px`, top: `${viewportBox.top}px` } : undefined

  const [rightOpen, setRightOpen] = useState(true)

  // --- ドメイン注入点（シェルでは空）---
  // ツールソースへ渡す依存（ストア・コールバック等）。参照安定にする（registry のメモ化キー）。
  const agentDeps = useMemo(() => ({}), [])
  // 毎ターンの system。揮発情報（現在の状態）は contextParts に文字列 / 関数で足す。
  const buildSystem = useCallback(() => buildSystemBlocks({ systemPrompt: SYSTEM_PROMPT, contextParts: [] }), [])
  // Gemini に追加で公開する関数（例: 画面のスクリーンショット）。[{ declaration, handler }]
  const voiceExtraTools = useMemo(() => [], [])

  // --- エージェント ---
  // 完了通知は音声セッション（後段で作る）へ ref 経由で転送する（フックの依存順の都合）。
  const agentFinishedRef = useRef(null)
  const handleAgentFinished = useCallback((result) => agentFinishedRef.current?.(result), [])
  const { messages, isRunning, chatInput, setChatInput, chatInputRef, handleSubmit, handleAbort, handleResetChat } =
    useAgentSession({
      deps: agentDeps,
      buildSystem,
      apiKey: settings.apiKey,
      model: settings.model,
      maxTokens: settings.maxTokens,
      log,
      onFinished: handleAgentFinished,
    })

  // --- 音声セッション（Gemini Live）---
  // Gemini には run_prompt（入力＋送信）と extraTools だけを渡す。処理は Claude の担当。
  const [activeTab, setActiveTab] = useState('chat')
  const runPromptFromVoice = useCallback(
    async (text) => {
      setActiveTab('chat')
      setRightOpen(true)
      return handleSubmit(text)
    },
    [handleSubmit],
  )
  const {
    voiceState,
    transcript: voiceTranscript,
    error: voiceError,
    elapsed: voiceElapsed,
    start: startVoice,
    stop: stopVoice,
    notifyAgentFinished,
  } = useVoiceSession({
    apiKey: settings.geminiApiKey,
    model: settings.voiceModel,
    isAgentRunning: isRunning,
    runPrompt: runPromptFromVoice,
    setChatInput,
    enableSearch: Boolean(settings.voiceSearch),
    voiceName: settings.voiceName,
    extraTools: voiceExtraTools,
    log,
  })
  useEffect(() => {
    agentFinishedRef.current = notifyAgentFinished
  }, [notifyAgentFinished])

  // 「新しい会話」= 会話・ログを全消去。
  const handleNewConversation = useCallback(() => {
    handleAbort()
    handleResetChat()
    setLogs([])
  }, [handleAbort, handleResetChat])

  // --- About / パネル ---
  const [aboutOpen, setAboutOpen] = useState(() => !loadSetting(SETTINGS_KEYS.introSeen))
  const handleCloseAbout = useCallback(() => {
    setAboutOpen(false)
    saveSetting(SETTINGS_KEYS.introSeen, '1')
  }, [])
  const [rightWidth, setRightWidth] = useState(420)
  const [rightHeight, setRightHeight] = useState(null)

  const chatDisabled = !settings.apiKey
  const chatDisabledReason = '⚙ 設定 から Claude API キーを設定してください。'

  const tabs = useMemo(
    () => [
      {
        id: 'chat',
        label: 'チャット',
        content: (
          <ChatPanel
            messages={messages}
            isRunning={isRunning}
            disabled={chatDisabled}
            disabledReason={chatDisabledReason}
            input={chatInput}
            onInputChange={setChatInput}
            inputRef={chatInputRef}
            onSubmit={handleSubmit}
            onAbort={handleAbort}
            onReset={handleNewConversation}
            voiceSlot={
              <VoiceButton
                state={voiceState}
                transcript={voiceTranscript}
                error={voiceError}
                elapsed={voiceElapsed}
                disabled={!settings.geminiApiKey}
                disabledReason="⚙ 設定 から Gemini API キーを設定すると音声で相談できます。"
                onStart={startVoice}
                onStop={stopVoice}
              />
            }
          />
        ),
      },
      { id: 'log', label: 'ログ', content: <ExecutionLog logs={logs} /> },
    ],
    [
      messages,
      isRunning,
      chatDisabled,
      chatInput,
      setChatInput,
      chatInputRef,
      handleSubmit,
      handleAbort,
      handleNewConversation,
      voiceState,
      voiceTranscript,
      voiceError,
      voiceElapsed,
      settings.geminiApiKey,
      startVoice,
      stopVoice,
      logs,
    ],
  )

  return (
    <div className="app-shell" style={shellStyle}>
      <Header
        rightOpen={rightOpen}
        onToggleRight={() => setRightOpen((v) => !v)}
        onShowAbout={() => setAboutOpen(true)}
        settingsSlot={
          <ApiSettings
            settings={settings}
            isOpen={settingsOpen}
            onToggle={() => setSettingsOpen((v) => !v)}
            onFieldChange={setField}
            onSave={save}
            onDeleteKeys={deleteKeys}
            tests={tests}
            onTestClaude={testClaude}
            onTestGemini={testGemini}
          />
        }
      />
      <div className="workspace">
        <main className="workspace-main">
          <p className="empty-state">ここにドメインの主画面（地図・キャンバス・表など）を置きます。</p>
        </main>
        <Sidebar
          side="right"
          open={rightOpen}
          width={rightWidth}
          onWidthChange={setRightWidth}
          height={rightHeight}
          onHeightChange={setRightHeight}
          minWidth={300}
          maxWidth={760}
        >
          <TabbedPanel tabs={tabs} activeId={activeTab} onTabChange={setActiveTab} />
        </Sidebar>
      </div>

      {aboutOpen && <AboutModal onClose={handleCloseAbout} />}
    </div>
  )
}

export default App
