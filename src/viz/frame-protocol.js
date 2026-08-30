// 可視化フレーム（隔離 iframe）との通信プロトコルの定数。
//
// 役割: 親側（viz-frame-bridge.js）と frame 側（public/viz-frame.js）で共有するメッセージ種別・既定サイズ・タイムアウト。
//       frame 側は classic script なのでこのモジュールを import できず、同じ文字列を手書きしている。
//       変更時は両方を直す（test/viz-frame-bridge.test.js が public/viz-frame.js に同じ文字列があることを突き合わせる）。
// 関係: viz-frame-bridge.js / tools/dataviz（render の既定値）/ public/viz-frame.js（手書きの写し）。
export const FRAME_MESSAGES = Object.freeze({
  READY: 'viz:ready', // frame → 親: 起動完了（load 時・リロード後）
  PUT_DATASET: 'viz:put-dataset', // 親 → frame: データセットをキャッシュへ
  RENDER: 'viz:render', // 親 → frame: 描画要求
  RESULT: 'viz:result', // frame → 親: 描画結果
  CLEAR: 'viz:clear', // 親 → frame: キャッシュと DOM をクリア
})

export const DEFAULT_VIZ_WIDTH = 960
export const DEFAULT_VIZ_HEIGHT = 600
export const MIN_VIZ_SIZE = 320
export const MAX_VIZ_SIZE = 4096

export const READY_TIMEOUT_MS = 10_000
export const RENDER_TIMEOUT_MS = 20_000

// public/ に置く実ファイル名（base './' 前提なので BASE_URL と連結して使う）。
export const VIZ_FRAME_PATH = 'viz-frame.html'
export const VIZ_RUNTIME_PATH = 'viz-runtime.js'

// サイズを許容範囲へ丸める（未指定は既定値）。
export function clampVizSize(value, fallback) {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(MAX_VIZ_SIZE, Math.max(MIN_VIZ_SIZE, Math.round(n)))
}
