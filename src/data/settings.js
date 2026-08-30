// 設定（API キー・モデル・音声設定）の localStorage 入出力。
//
// 役割: 保存キーと既定値を一箇所に集約し、読み書きを try/catch で包む
//       （アクセス制限環境でも画面は動くようにする）。localStorage のキー接頭辞もここで決める
//       （会話・チャット表示・ログのキーも storageKey() から作る）。
// 関係: hooks/useSettings.js が使う。キーはバンドルに埋め込まず利用者が入力する。
import { DEFAULT_VOICE_MODEL, DEFAULT_VOICE_NAME } from '../voice/voice-options.js'

// 音声の既定値の単一情報源は voice/voice-options.js（UI から @google/genai を引き込まないための分離）。
export { DEFAULT_VOICE_MODEL, DEFAULT_VOICE_NAME }

export const STORAGE_PREFIX = 'voice-agent-shell.'
export const storageKey = (name) => `${STORAGE_PREFIX}${name}`

export const SETTINGS_KEYS = {
  apiKey: storageKey('apiKey'),
  model: storageKey('model'),
  maxTokens: storageKey('maxTokens'),
  geminiApiKey: storageKey('geminiApiKey'),
  voiceModel: storageKey('voiceModel'),
  voiceSearch: storageKey('voiceSearch'),
  voiceName: storageKey('voiceName'),
  introSeen: storageKey('introSeen'),
}

export const DEFAULT_MODEL = 'claude-opus-4-8'
export const DEFAULT_MAX_TOKENS = 16000

export function loadSetting(key, fallback = '') {
  try {
    return globalThis.localStorage?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function saveSetting(key, value) {
  try {
    if (value == null || value === '') globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, String(value))
  } catch {
    // 保存失敗は致命的でない（メモリ上の設定は有効）。
  }
}

export function loadAllSettings() {
  return {
    apiKey: loadSetting(SETTINGS_KEYS.apiKey),
    model: loadSetting(SETTINGS_KEYS.model) || DEFAULT_MODEL,
    maxTokens: Number(loadSetting(SETTINGS_KEYS.maxTokens)) || DEFAULT_MAX_TOKENS,
    geminiApiKey: loadSetting(SETTINGS_KEYS.geminiApiKey),
    voiceModel: loadSetting(SETTINGS_KEYS.voiceModel) || DEFAULT_VOICE_MODEL,
    voiceSearch: loadSetting(SETTINGS_KEYS.voiceSearch) === '1',
    voiceName: loadSetting(SETTINGS_KEYS.voiceName) || DEFAULT_VOICE_NAME,
  }
}
