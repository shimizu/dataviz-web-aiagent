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
import { useHydrateOnce, useHydrated, useStoreItems } from './hooks/useDatavizStores'

import { composeSystemPrompt } from './agent/system-prompt.js'
import { buildSystemBlocks } from './agent/system-context.js'
import { SOURCES } from './tools/sources.js'
import { loadSetting, saveSetting, SETTINGS_KEYS, storageKey } from './data/settings.js'
import { datasetStore } from './data/dataset-store.js'
import { fileStore } from './data/file-store.js'
import { visualizationStore } from './data/visualization-store.js'
import { analysisCache } from './data/analysis-cache.js'
import { importFiles } from './data/import-files.js'
import { formatDatasetList } from './data/dataset-shapes.js'
import { createVizFrameBridge } from './viz/viz-frame-bridge.js'
import { VIZ_FRAME_PATH, VIZ_RUNTIME_PATH } from './viz/frame-protocol.js'
import { VIZ_THEME } from './viz/viz-theme.js'
import { svgToBlob, toFileName } from './viz/svg-export.js'
import { svgToJpegBase64, svgToPngBlob } from './viz/png-export.js'
import { buildZipFiles, createZipBlob, zipFileName } from './viz/zip-export.js'
import { buildFinishedExtras, buildVoiceContextText, buildVoiceSnapshotData } from './viz/voice-summary.js'
import { downloadBlob } from './viz/download.js'
import { uuid } from './utils/ids.js'

import DatavizWorkspace from './components/dataviz/DatavizWorkspace'
import VizCard from './components/dataviz/VizCard'
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
// ストアはモジュールスコープに 1 つだけ置く（agentDeps を参照安定にして registry を作り直さないため）。
const DATAVIZ_STORES = [datasetStore, fileStore, visualizationStore]
// 可視化フレーム（隔離 iframe）の URL。base './' でも相対で解決できる。
const VIZ_FRAME_SRC = `${import.meta.env.BASE_URL}${VIZ_FRAME_PATH}`
const VIZ_RUNTIME_SRC = `${import.meta.env.BASE_URL}${VIZ_RUNTIME_PATH}`

// zip 同梱用にライブラリ本体を取ってくる（同一オリジンなので connect-src 'self' で通る）。1 度だけ。
let runtimeSourcePromise = null
function loadRuntimeSource() {
  runtimeSourcePromise ??= fetch(VIZ_RUNTIME_SRC).then((r) => {
    if (!r.ok) throw new Error(`viz-runtime.js を読み込めませんでした（${r.status}）`)
    return r.text()
  })
  return runtimeSourcePromise
}

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

  // --- データ（アップロードされたデータセット）---
  useHydrateOnce(DATAVIZ_STORES)
  const datasets = useStoreItems(datasetStore)
  const datasetsHydrated = useHydrated(datasetStore)
  const visualizations = useStoreItems(visualizationStore)
  const [importBusy, setImportBusy] = useState(false)
  const [importErrors, setImportErrors] = useState([])

  const handleFiles = useCallback(
    async (files) => {
      setImportBusy(true)
      setImportErrors([])
      try {
        const { added, errors } = await importFiles(files, { datasetStore, fileStore, log })
        setImportErrors(errors)
        if (added.length > 0) log(`✓ ${added.length} 件のデータセットを読み込みました`)
      } finally {
        setImportBusy(false)
      }
    },
    [log],
  )
  const handleRemoveDataset = useCallback(
    (id) => {
      const target = datasetStore.get(id)
      if (target) log(`🗑 ${id}（${target.name}）を削除しました`)
      datasetStore.remove(id)
    },
    [log],
  )

  // --- 可視化フレーム（隔離 iframe）---
  // bridge は 1 度だけ作る（iframe を作り直すと読み込みからやり直しになる）。
  const bridgeRef = useRef(null)
  if (!bridgeRef.current) bridgeRef.current = createVizFrameBridge({ src: VIZ_FRAME_SRC, log })
  const vizBridge = bridgeRef.current
  const [frameReady, setFrameReady] = useState(false)
  useEffect(() => {
    let alive = true
    vizBridge
      .ready()
      .then(() => alive && setFrameReady(true))
      .catch((e) => alive && log(`✗ ${e.message}`))
    return () => {
      alive = false
    }
  }, [vizBridge, log])

  const [workspaceTab, setWorkspaceTab] = useState('data')
  const [currentViz, setCurrentViz] = useState(null) // { vizId, version }
  // フレームに今描かれているもの（同じものを選び直したときに再描画しない）。
  const shownRef = useRef(null)

  // 保存済みのバージョンをフレームに描き直す（バージョン切替・カードからの表示）。
  const displayVersion = useCallback(
    async (vizId, version) => {
      const viz = visualizationStore.get(vizId)
      const target = visualizationStore.getVersion(vizId, version)
      if (!viz || !target) return
      setCurrentViz({ vizId, version: target.version })
      setWorkspaceTab('viz')
      const key = `${vizId}:${target.version}`
      if (shownRef.current === key) return
      shownRef.current = key
      try {
        for (const id of viz.datasetIds) {
          const runtime = datasetStore.getRuntime(id)
          if (runtime) await vizBridge.putDataset(runtime)
        }
        await vizBridge.render({ code: target.code, datasetIds: viz.datasetIds, width: target.width, height: target.height, theme: VIZ_THEME })
      } catch (e) {
        shownRef.current = null
        log(`✗ 再描画に失敗: ${e.message}`)
      }
    },
    [vizBridge, log],
  )
  // ツールが描画した直後の通知（フレームには描画済みなので再描画しない）。
  const handleVisualizationShown = useCallback((vizId) => {
    const viz = visualizationStore.get(vizId)
    if (!viz) return
    shownRef.current = `${vizId}:${viz.currentVersion}`
    setCurrentViz({ vizId, version: viz.currentVersion })
    setWorkspaceTab('viz')
  }, [])
  const shownCallbackRef = useRef(handleVisualizationShown)
  useEffect(() => {
    shownCallbackRef.current = handleVisualizationShown
  }, [handleVisualizationShown])

  // --- 書き出し（SVG / PNG / ZIP）---
  const [downloading, setDownloading] = useState(false)
  const handleDownload = useCallback(
    async (kind) => {
      const target = currentViz
      const viz = target ? visualizationStore.get(target.vizId) : null
      const version = viz ? visualizationStore.getVersion(viz.id, target.version) : null
      if (!viz || !version) {
        log('✗ 書き出す可視化がありません')
        return
      }
      setDownloading(true)
      try {
        const label = `${viz.title}_v${version.version}`
        if (kind === 'svg') {
          downloadBlob(svgToBlob(version.svg, { width: version.width, height: version.height }), toFileName(label, 'svg'))
        } else if (kind === 'png') {
          const blob = await svgToPngBlob(version.svg, { width: version.width, height: version.height })
          downloadBlob(blob, toFileName(label, 'png'))
        } else {
          const runtimeSource = await loadRuntimeSource()
          const datasets = viz.datasetIds.map((id) => datasetStore.getRuntime(id)).filter(Boolean)
          const originals = viz.datasetIds
            .map((id) => datasetStore.get(id)?.sourceFileId)
            .filter(Boolean)
            .map((fileId) => fileStore.get(fileId))
            .filter(Boolean)
          const files = buildZipFiles({ viz, version, datasets, originals, runtimeSource, theme: VIZ_THEME })
          downloadBlob(await createZipBlob(files), zipFileName(label))
        }
        log(`💾 ${viz.id} v${version.version} を ${kind.toUpperCase()} で書き出しました`)
      } catch (e) {
        log(`✗ 書き出しに失敗: ${e.message}`)
      } finally {
        setDownloading(false)
      }
    },
    [currentViz, log],
  )

  // --- ドメイン注入点 ---
  // ツールソースへ渡す依存。すべてモジュールスコープのストア / ref 由来なので参照安定（registry のメモ化キー）。
  const agentDeps = useMemo(
    () => ({
      datasetStore,
      visualizationStore,
      vizBridge,
      // execute_javascript がデータセットを読む口（同期）。
      getDataset: (id) => datasetStore.getRuntime(id),
      // JS 実行の全行を保持して save_dataset で昇格できるようにする。
      onAnalysisResult: (result) => analysisCache.put(result),
      getAnalysisResult: (codeHash) => analysisCache.get(codeHash),
      // 描画後に可視化タブへ切り替える。
      onVisualizationShown: (vizId) => shownCallbackRef.current?.(vizId),
    }),
    [vizBridge],
  )
  // 毎ターンの system。揮発情報（現在の状態）は contextParts に文字列 / 関数で足す。
  const buildSystem = useCallback(
    () => buildSystemBlocks({ systemPrompt: SYSTEM_PROMPT, contextParts: [() => formatDatasetList(datasets)] }),
    [datasets],
  )
  // --- 音声に渡す状況とツール ---
  // 状況は毎ターン変わるので ref から読む（extraTools / buildContext の参照を変えず start を作り直さない）。
  const voiceStateRef = useRef({ datasets, visualizations, currentViz })
  useEffect(() => {
    voiceStateRef.current = { datasets, visualizations, currentViz }
  }, [datasets, visualizations, currentViz])

  // 現在表示中の可視化とそのバージョン（音声ツールと buildSnapshot で使う）。ref から読むので参照は安定。
  const getCurrentVersion = useCallback(() => {
    const { currentViz: target } = voiceStateRef.current
    const viz = target ? visualizationStore.get(target.vizId) : null
    if (!viz) return null
    return { viz, version: visualizationStore.getVersion(viz.id, target.version) }
  }, [])

  // 接続時の指示文に入れる状況（文字列）と、ツール応答へ同梱する状況（オブジェクト）。組み立ては viz/voice-summary.js。
  const buildVoiceContext = useCallback(() => {
    const current = getCurrentVersion()
    return buildVoiceContextText({ datasets: voiceStateRef.current.datasets, viz: current?.viz ?? null, version: current?.version ?? null })
  }, [getCurrentVersion])
  const buildVoiceSnapshot = useCallback(() => {
    const current = getCurrentVersion()
    return buildVoiceSnapshotData({ datasets: voiceStateRef.current.datasets, viz: current?.viz ?? null, version: current?.version ?? null })
  }, [getCurrentVersion])

  // Gemini に追加で公開する関数。画像は「sendImage → 応答」の順で渡す。
  const voiceExtraTools = useMemo(
    () => [
      {
        declaration: {
          name: 'look_at_visualization',
          description:
            '今表示している可視化を画像として見る。ユーザーが「この図どう？」「何が分かる？」「見て」と言ったときに、答える前に呼ぶ。',
          parameters: { type: 'OBJECT', properties: {} },
        },
        async handler(_args, { session, log }) {
          const current = getCurrentVersion()
          if (!current?.version?.svg) return { looked: false, error: 'まだ可視化がありません。先に図を作るよう案内してください' }
          try {
            const base64 = await svgToJpegBase64(current.version.svg, { width: current.version.width, height: current.version.height })
            session.sendImage(base64, 'image/jpeg')
            log?.(`🎙 可視化 ${current.viz.id} v${current.version.version} を音声セッションへ送信`)
            return { looked: true, title: current.viz.title, vizId: current.viz.id, version: current.version.version }
          } catch (e) {
            return { looked: false, error: `画像にできませんでした: ${e.message}` }
          }
        },
      },
    ],
    [getCurrentVersion],
  )

  // --- エージェント ---
  // 完了通知は音声セッション（後段で作る）へ ref 経由で転送する（フックの依存順の都合）。
  const agentFinishedRef = useRef(null)
  const handleAgentFinished = useCallback(
    (result) => {
      const current = getCurrentVersion()
      const extras = buildFinishedExtras({ viz: current?.viz ?? null, version: current?.version ?? null })
      agentFinishedRef.current?.({ ...result, extras: extras ? [extras] : [] })
    },
    [getCurrentVersion],
  )
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
    buildContext: buildVoiceContext,
    buildSnapshot: buildVoiceSnapshot,
    extraTools: voiceExtraTools,
    log,
  })
  useEffect(() => {
    agentFinishedRef.current = notifyAgentFinished
  }, [notifyAgentFinished])

  // 「新しい会話」= 会話・ログ・読み込んだデータ・可視化を全消去。
  const handleNewConversation = useCallback(() => {
    handleAbort()
    handleResetChat()
    setLogs([])
    datasetStore.clear()
    fileStore.clear()
    visualizationStore.clear()
    analysisCache.clear()
    vizBridge.clear()
    shownRef.current = null
    setCurrentViz(null)
    setImportErrors([])
    setWorkspaceTab('data')
  }, [handleAbort, handleResetChat, vizBridge])

  // チャットの可視化カード（kind: 'viz'）。SVG はストアから引く（メッセージには ID だけ持たせる）。
  const renderMessage = useCallback(
    (message) => {
      if (message.kind !== 'viz') return null
      const version = visualizationStore.getVersion(message.vizId, message.version)
      return <VizCard vizId={message.vizId} version={message.version} title={message.title} svg={version?.svg ?? null} onShow={displayVersion} />
    },
    // visualizations の変化（復元・削除）でカードを描き直す。
    // eslint-disable-next-line @eslint-react/exhaustive-deps
    [displayVersion, visualizations],
  )

  // --- About / パネル ---
  const [aboutOpen, setAboutOpen] = useState(() => !loadSetting(SETTINGS_KEYS.introSeen))
  const handleCloseAbout = useCallback(() => {
    setAboutOpen(false)
    saveSetting(SETTINGS_KEYS.introSeen, '1')
  }, [])
  const [rightWidth, setRightWidth] = useState(420)
  const [rightHeight, setRightHeight] = useState(null)

  const chatDisabled = !settings.apiKey || !datasetsHydrated
  const chatDisabledReason = settings.apiKey
    ? '保存済みデータを読み込んでいます…'
    : '⚙ 設定 から Claude API キーを設定してください。'

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
            renderMessage={renderMessage}
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
      chatDisabledReason,
      chatInput,
      setChatInput,
      chatInputRef,
      handleSubmit,
      handleAbort,
      handleNewConversation,
      renderMessage,
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
        title="データ可視化エージェント"
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
          <DatavizWorkspace
            activeTab={workspaceTab}
            onTabChange={setWorkspaceTab}
            datasets={datasets}
            hydrated={datasetsHydrated}
            busy={importBusy}
            errors={importErrors}
            onFiles={handleFiles}
            onRemoveDataset={handleRemoveDataset}
            visualizations={visualizations}
            currentViz={currentViz}
            frameElement={vizBridge.element}
            frameReady={frameReady}
            downloading={downloading}
            onSelectViz={(vizId) => displayVersion(vizId)}
            onSelectVizVersion={displayVersion}
            onDownload={handleDownload}
          />
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
