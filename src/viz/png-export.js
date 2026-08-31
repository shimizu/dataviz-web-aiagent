// SVG → PNG / JPEG（ブラウザ専用）。
//
// 役割: SVG 文字列を data URL にして <img> に読ませ、canvas へ等倍以上で描いて画像 Blob にする。
//       **blob: ではなく data: を使う**（親の CSP は img-src 'self' data: なので変更不要）。
//       SVG 内の画像はすべて data: URL で埋め込まれている前提（外部参照はフレームの警告で弾く）。
// 関係: svg-export.js（整形）、App の DL ボタン、音声の look_at_visualization（JPEG base64）。
import { svgToDataUrl } from './svg-export.js'

export const DEFAULT_PNG_SCALE = 2

// SVG を <img> として読み込む。
function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('SVG を画像として読み込めませんでした（外部参照や不正な属性が含まれていないか確認してください）'))
    img.src = dataUrl
  })
}

// SVG を canvas に描く。戻り値は canvas。
export async function svgToCanvas(svg, { width, height, scale = DEFAULT_PNG_SCALE, background = '#ffffff' } = {}) {
  const w = Math.max(1, Math.round(Number(width) || 0))
  const h = Math.max(1, Math.round(Number(height) || 0))
  if (!w || !h) throw new Error('width / height が不明です')
  const img = await loadImage(svgToDataUrl(svg, { width: w, height: h, background, declaration: false }))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * scale)
  canvas.height = Math.round(h * scale)
  const ctx = canvas.getContext('2d')
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas
}

// PNG の Blob（ダウンロード用）。
export async function svgToPngBlob(svg, options) {
  const canvas = await svgToCanvas(svg, options)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG への変換に失敗しました'))), 'image/png')
  })
}

// PNG の base64（tool_result で Claude 自身に描画結果を見せる用。data URL の接頭辞は含めない）。
// 図は細線と文字が主役なので JPEG でなく PNG（アーティファクトで読みにくくならない）。
export async function svgToPngBase64(svg, { maxWidth = 800, ...options } = {}) {
  const width = Number(options.width) || maxWidth
  const scale = Math.min(1, maxWidth / width)
  const canvas = await svgToCanvas(svg, { ...options, scale })
  return canvas.toDataURL('image/png').split(',')[1] ?? ''
}

// JPEG の base64（音声セッションへ画像を送る用。data URL の接頭辞は含めない）。
export async function svgToJpegBase64(svg, { maxWidth = 1024, quality = 0.82, ...options } = {}) {
  const width = Number(options.width) || maxWidth
  const scale = Math.min(1, maxWidth / width)
  const canvas = await svgToCanvas(svg, { ...options, scale })
  return canvas.toDataURL('image/jpeg', quality).split(',')[1] ?? ''
}
