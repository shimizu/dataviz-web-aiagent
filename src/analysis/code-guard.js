// 生成 JavaScript の実行前検査。
//
// 役割: 明らかに実行させたくない参照（ネットワーク・ストレージ・動的 import）を文字列で弾く。
//       文字列検索で安全性は保証できないため、これは誤操作の早期検出にすぎない。
//       主防御は使い捨て Worker・Worker 側の lockdown・タイムアウト・入出力の上限・CSP。
// 関係: analysis-runner.js が実行前に呼ぶ。純関数なのでテスト対象。
// 流用元: e-Stat-Web-AI-Agent/src/analysis/code-guard.js
const FORBIDDEN_PATTERNS = [
  { name: 'fetch', re: /\bfetch\s*\(/ },
  { name: 'WebSocket', re: /\bWebSocket\b/ },
  { name: 'XMLHttpRequest', re: /\bXMLHttpRequest\b/ },
  { name: 'EventSource', re: /\bEventSource\b/ },
  { name: 'importScripts', re: /\bimportScripts\s*\(/ },
  { name: '動的 import', re: /\bimport\s*\(/ },
  { name: 'indexedDB', re: /\bindexedDB\b/ },
  { name: 'localStorage', re: /\blocalStorage\b/ },
  { name: 'sessionStorage', re: /\bsessionStorage\b/ },
  { name: 'postMessage', re: /\bpostMessage\s*\(/ },
]

// 生成コードを検査し、禁止トークンに当たれば名前の配列を返す（問題なければ空配列）。
export function findForbiddenTokens(code) {
  const text = String(code ?? '')
  return FORBIDDEN_PATTERNS.filter(({ re }) => re.test(text)).map(({ name }) => name)
}

// 事前検査を通るか。{ ok, reasons } を返す。
export function inspectCode(code) {
  const reasons = findForbiddenTokens(code)
  return { ok: reasons.length === 0, reasons }
}

// 実行コードの同一性確認用の簡易ハッシュ（FNV-1a・非暗号）。ログの突き合わせに使うだけで衝突耐性は要求しない。
export function hashCode(code) {
  const text = String(code ?? '')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
