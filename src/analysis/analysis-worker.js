// 使い捨て Web Worker の本体。メインスレッドから分離された環境で生成 JavaScript を実行する。
//
// 役割: 受信 { code, input } → analyze(input) を実行 → { ok: true, result } / { ok: false, error } を返信。
//       完全なセキュリティ境界ではない。外部通信は本番ビルドの CSP（connect-src）で遮断し、
//       ここでも主要なネットワーク/ストレージ API を undefined 化して多重に防ぐ。
// 関係: analysis-runner.js が new Worker で毎回作り、完了・失敗・タイムアウトのいずれでも terminate する。
//       runUserCode だけは Node のテストから直接呼べるように export する。
// 流用元: e-Stat-Web-AI-Agent/src/analysis/analysis-worker.js

// ネットワーク・ストレージ API を無効化する（CSP と合わせた多重防御）。
function lockdown(scope) {
  const blocked = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'localStorage', 'sessionStorage']
  for (const name of blocked) {
    try {
      Object.defineProperty(scope, name, { value: undefined, configurable: false, writable: false })
    } catch {
      // 再定義できないプロパティは無視する（CSP が最終防衛）。
    }
  }
}

// 生成コードを関数スコープで評価し、analyze 関数を取り出して呼ぶ。
export function runUserCode(code, input) {
  // 未定義でも ReferenceError にせず typeof で拾い、モデルが直せる日本語のエラーにする。
  const factory = new Function(`"use strict";\n${code}\nreturn typeof analyze === 'function' ? analyze : undefined;`)
  const analyze = factory()
  if (typeof analyze !== 'function') throw new Error('analyze 関数が定義されていません')
  return analyze(input)
}

// Worker コンテキストでのみメッセージ購読を登録する（Node のテストで import しても副作用が出ないように）。
if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  lockdown(self)
  self.addEventListener('message', (event) => {
    const { code, input } = event.data ?? {}
    try {
      self.postMessage({ ok: true, result: runUserCode(code, input) })
    } catch (error) {
      self.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
