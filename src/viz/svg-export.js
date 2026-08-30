// SVG の書き出し（純関数）。
//
// 役割: 可視化フレームから受け取った SVG 文字列を、単体のファイルとして開ける形に整える
//       （XML 宣言・xmlns・幅高さ・背景）。フレーム側で xmlns と viewBox は補完済みだが、
//       保存済みの古いバージョンや手書きの SVG でも壊れないようにここでも面倒を見る。
// 関係: viz/png-export.js（同じ整形結果を画像化する）、viz/zip-export.js（zip に同梱）、App の DL ボタン。
const SVG_NS = 'http://www.w3.org/2000/svg'
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>'

// ルートの <svg ...> 開始タグに属性を足す（無いものだけ）。
function ensureAttributes(svg, attributes) {
  const match = /<svg\b([^>]*)>/i.exec(svg)
  if (!match) throw new Error('SVG ではありません（<svg> 要素が見つかりません）')
  let attrs = match[1]
  for (const [name, value] of Object.entries(attributes)) {
    if (value == null) continue
    const has = new RegExp(`(^|\\s)${name.replace(':', '\\:')}\\s*=`, 'i').test(attrs)
    if (!has) attrs += ` ${name}="${String(value).replace(/"/g, '&quot;')}"`
  }
  return svg.replace(match[0], `<svg${attrs}>`)
}

// 背景色を敷く（PNG 化と単体表示のため。既に rect があっても重ねない）。
function ensureBackground(svg, background, width, height) {
  if (!background) return svg
  const open = /<svg\b[^>]*>/i.exec(svg)
  if (!open) return svg
  const rect = `<rect x="0" y="0" width="${width ?? '100%'}" height="${height ?? '100%'}" fill="${background}"/>`
  return svg.replace(open[0], `${open[0]}${rect}`)
}

// 単体ファイルとして開ける SVG 文字列にする。
export function normalizeSvgForExport(svg, { width, height, background = '#ffffff', declaration = true } = {}) {
  const source = String(svg ?? '').trim()
  if (!source) throw new Error('SVG が空です')
  let out = ensureAttributes(source, { xmlns: SVG_NS, width, height })
  out = ensureBackground(out, background, width, height)
  return declaration ? `${XML_DECLARATION}\n${out}` : out
}

// ダウンロード用の Blob（ブラウザ）。
export function svgToBlob(svg, options) {
  return new Blob([normalizeSvgForExport(svg, options)], { type: 'image/svg+xml;charset=utf-8' })
}

// <img> に読ませるための data URL（blob: を使わない = 親の CSP を変えずに済む）。
export function svgToDataUrl(svg, options) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalizeSvgForExport(svg, options))}`
}

// ファイル名に使えない文字を落とす。
export function toFileName(title, extension) {
  const base = String(title ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 60)
  return `${base || 'visualization'}.${extension}`
}
