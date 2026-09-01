// 書き出し用のフォント埋め込み。
//
// 役割: <img> に読み込んだ SVG は仕様上外部リソースを取得しないため、SVG 単体 / PNG / zip の書き出しでは
//       Web フォント（Roboto Condensed / Noto Sans JP）が効かない。ここで Google Fonts の css2 を取得し、
//       unicode-range 分割チャンクのうち **SVG 中の使用文字と交差するものだけ** を data: URL の
//       @font-face にして <style> として SVG に注入する（和文全量 5MB 超の埋め込みを避ける）。
// 関係: App の DL ボタン（svg / png）・zip-export（fonts.css として同梱）・visualization-handlers の
//       フィードバック PNG。パース・選択は純関数（node --test 対象）、fetch は注入可能。
//       失敗（オフライン・CSP）は呼び出し元でフォールバックし、書き出し自体は成功させる。
export const FONT_CSS_URL =
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&family=Roboto+Condensed:ital,wght@0,100..900;1,100..900&display=swap'

// css2 の @font-face 群をパースする（純関数）。
// 返り値: [{ family, style, weight, url, ranges: [[lo, hi], ...] }]
export function parseFontFaces(cssText) {
  const faces = []
  const blocks = String(cssText ?? '').match(/@font-face\s*\{[^}]*\}/g) ?? []
  for (const block of blocks) {
    const prop = (name) => {
      const m = new RegExp(`${name}\\s*:\\s*([^;}]+)`, 'i').exec(block)
      return m ? m[1].trim() : ''
    }
    const src = /url\((['"]?)([^'")]+)\1\)/.exec(prop('src'))
    if (!src) continue
    faces.push({
      family: prop('font-family').replace(/^['"]|['"]$/g, ''),
      style: prop('font-style') || 'normal',
      weight: prop('font-weight') || '400',
      url: src[2],
      ranges: parseUnicodeRange(prop('unicode-range')),
    })
  }
  return faces
}

// "U+0-FF, U+131, U+1F600-1F64F" → [[0, 255], [0x131, 0x131], ...]（純関数）。
export function parseUnicodeRange(text) {
  const ranges = []
  for (const part of String(text ?? '').split(',')) {
    const m = /U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?/.exec(part.trim())
    if (!m) continue
    if (m[1].includes('?')) {
      // U+4?? のようなワイルドカード: ? を 0 / F で埋めた範囲
      const lo = parseInt(m[1].replace(/\?/g, '0'), 16)
      const hi = parseInt(m[1].replace(/\?/g, 'F'), 16)
      ranges.push([lo, hi])
    } else {
      const lo = parseInt(m[1], 16)
      ranges.push([lo, m[2] ? parseInt(m[2], 16) : lo])
    }
  }
  return ranges
}

// SVG 文字列から表示される文字のコードポイント集合を取る（タグ・属性は除く。純関数）。
export function usedCodePoints(svgText) {
  const text = String(svgText ?? '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, '')
  const points = new Set()
  for (const ch of text) points.add(ch.codePointAt(0))
  return points
}

// 使用文字と unicode-range が交差する face だけ選ぶ（純関数）。
export function selectFaces(faces, points) {
  return faces.filter((face) => {
    if (face.ranges.length === 0) return true // range 無しは常に対象
    for (const [lo, hi] of face.ranges) {
      for (const p of points) if (p >= lo && p <= hi) return true
    }
    return false
  })
}

// 選ばれた face 群を data: URL の @font-face CSS にする（dataUrls は url → data URL。純関数）。
export function buildFontFaceCss(faces, dataUrls) {
  return faces
    .map((face) => {
      const data = dataUrls.get(face.url)
      if (!data) return ''
      const range = face.ranges.length
        ? `unicode-range:${face.ranges.map(([lo, hi]) => (lo === hi ? `U+${lo.toString(16)}` : `U+${lo.toString(16)}-${hi.toString(16)}`)).join(',')};`
        : ''
      return `@font-face{font-family:'${face.family}';font-style:${face.style};font-weight:${face.weight};src:url(${data}) format('woff2');${range}}`
    })
    .filter(Boolean)
    .join('\n')
}

// --- ここからブラウザ用（fetch あり） ---

const cssCache = new Map() // url → Promise<string>
const fontCache = new Map() // url → Promise<dataUrl>

async function fetchCss(url) {
  if (!cssCache.has(url)) {
    cssCache.set(
      url,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`フォント CSS の取得に失敗: ${r.status}`)
        return r.text()
      }),
    )
  }
  return cssCache.get(url)
}

async function fetchFontDataUrl(url) {
  if (!fontCache.has(url)) {
    fontCache.set(
      url,
      fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`フォントの取得に失敗: ${r.status}`)
          return r.arrayBuffer()
        })
        .then((buf) => {
          const bytes = new Uint8Array(buf)
          let bin = ''
          for (let i = 0; i < bytes.length; i += 0x8000) {
            bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
          }
          return `data:font/woff2;base64,${btoa(bin)}`
        }),
    )
  }
  return fontCache.get(url)
}

// SVG の使用文字に必要な @font-face CSS（data: 埋め込み済み）を作る。
export async function buildEmbeddedFontCss(svgText, { cssUrl = FONT_CSS_URL, loadCss = fetchCss, loadFont = fetchFontDataUrl } = {}) {
  const faces = selectFaces(parseFontFaces(await loadCss(cssUrl)), usedCodePoints(svgText))
  const dataUrls = new Map()
  await Promise.all(
    faces.map(async (face) => {
      dataUrls.set(face.url, await loadFont(face.url))
    }),
  )
  return buildFontFaceCss(faces, dataUrls)
}

// SVG に <style> として注入する。失敗時は例外（呼び出し元でフォールバック）。
export async function embedFontsInSvg(svgText, options) {
  const css = await buildEmbeddedFontCss(svgText, options)
  if (!css) return svgText
  const open = /<svg\b[^>]*>/i.exec(svgText)
  if (!open) return svgText
  return svgText.replace(open[0], `${open[0]}<style>${css}</style>`)
}

// フォールバック付きの包み（書き出しを失敗させない）。
export async function tryEmbedFontsInSvg(svgText, { log, ...options } = {}) {
  try {
    return await embedFontsInSvg(svgText, options)
  } catch (error) {
    log?.(`⚠ フォント埋め込みに失敗（システムフォントで書き出し）: ${error instanceof Error ? error.message : error}`)
    return svgText
  }
}
