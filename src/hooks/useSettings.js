// 設定（Claude API キー・モデル・max_tokens・Gemini キー・音声設定）の結線フック。
//
// 役割: 設定値の state と localStorage への保存/削除、設定ポップオーバーの開閉、接続テストを持つ。
// 関係: App が ApiSettings へ渡し、useAgentSession / useVoiceSession が値を使う。
import { useCallback, useState } from 'react'
import { loadAllSettings, saveSetting, SETTINGS_KEYS } from '../data/settings.js'
import { testClaudeConnection } from '../agent/claude-client.js'
import { testGeminiConnection } from '../voice/gemini-test.js'

const IDLE = { status: 'idle', message: '' }

export function useSettings() {
  const [settings, setSettings] = useState(loadAllSettings)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // 接続テストの結果（claude / gemini）。{ status: idle|running|ok|warn|error, message }
  const [tests, setTests] = useState({ claude: IDLE, gemini: IDLE })

  const setField = useCallback((name, value) => {
    setSettings((cur) => ({ ...cur, [name]: value }))
    // 値を変えたら古いテスト結果は消す。
    if (name === 'apiKey' || name === 'model') setTests((t) => ({ ...t, claude: IDLE }))
    if (name === 'geminiApiKey' || name === 'voiceModel') setTests((t) => ({ ...t, gemini: IDLE }))
  }, [])

  const testClaude = useCallback(async () => {
    setTests((t) => ({ ...t, claude: { status: 'running', message: '確認中…' } }))
    const r = await testClaudeConnection({ apiKey: settings.apiKey, model: settings.model })
    setTests((t) => ({ ...t, claude: { status: r.ok ? (r.modelFound ? 'ok' : 'warn') : 'error', message: r.message } }))
    return r
  }, [settings.apiKey, settings.model])

  const testGemini = useCallback(async () => {
    setTests((t) => ({ ...t, gemini: { status: 'running', message: '確認中…' } }))
    const r = await testGeminiConnection({ apiKey: settings.geminiApiKey, model: settings.voiceModel })
    setTests((t) => ({ ...t, gemini: { status: r.ok ? (r.modelFound ? 'ok' : 'warn') : 'error', message: r.message } }))
    return r
  }, [settings.geminiApiKey, settings.voiceModel])

  const save = useCallback(() => {
    const clean = {
      ...settings,
      apiKey: String(settings.apiKey ?? '').trim(),
      geminiApiKey: String(settings.geminiApiKey ?? '').trim(),
    }
    setSettings(clean)
    saveSetting(SETTINGS_KEYS.apiKey, clean.apiKey)
    saveSetting(SETTINGS_KEYS.model, clean.model)
    saveSetting(SETTINGS_KEYS.maxTokens, String(clean.maxTokens))
    saveSetting(SETTINGS_KEYS.geminiApiKey, clean.geminiApiKey)
    saveSetting(SETTINGS_KEYS.voiceModel, clean.voiceModel)
    saveSetting(SETTINGS_KEYS.voiceSearch, clean.voiceSearch ? '1' : '')
    saveSetting(SETTINGS_KEYS.voiceName, clean.voiceName)
    setSettingsOpen(false)
    return clean
  }, [settings])

  const deleteKeys = useCallback(() => {
    setSettings((cur) => ({ ...cur, apiKey: '', geminiApiKey: '' }))
    saveSetting(SETTINGS_KEYS.apiKey, '')
    saveSetting(SETTINGS_KEYS.geminiApiKey, '')
  }, [])

  return { settings, setField, save, deleteKeys, settingsOpen, setSettingsOpen, tests, testClaude, testGemini }
}
