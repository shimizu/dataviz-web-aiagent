// font-embed（書き出し用フォント埋め込み）の純ロジックのテスト。fetch は注入で差し替える。
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildEmbeddedFontCss,
  buildFontFaceCss,
  embedFontsInSvg,
  parseFontFaces,
  parseUnicodeRange,
  selectFaces,
  tryEmbedFontsInSvg,
  usedCodePoints,
} from '../src/viz/font-embed.js'

const CSS_FIXTURE = `
/* latin */
@font-face {
  font-family: 'Roboto Condensed';
  font-style: normal;
  font-weight: 100 900;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/robotocondensed/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+2013-2014;
}
/* [102] 日本語チャンク（東 = U+6771 を含む） */
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/notosansjp/jp102.woff2) format('woff2');
  unicode-range: U+6700-67FF;
}
/* [103] 使わないチャンク */
@font-face {
  font-family: 'Noto Sans JP';
  font-style: normal;
  font-weight: 100 900;
  src: url(https://fonts.gstatic.com/s/notosansjp/jp103.woff2) format('woff2');
  unicode-range: U+9800-98FF;
}
`

test('parseFontFaces / parseUnicodeRange は family・weight・url・range を取り出す', () => {
  const faces = parseFontFaces(CSS_FIXTURE)
  assert.equal(faces.length, 3)
  assert.equal(faces[0].family, 'Roboto Condensed')
  assert.equal(faces[0].weight, '100 900')
  assert.match(faces[0].url, /latin\.woff2$/)
  assert.deepEqual(faces[0].ranges, [[0x0, 0xff], [0x2013, 0x2014]])
  assert.deepEqual(parseUnicodeRange('U+4??'), [[0x400, 0x4ff]])
  assert.deepEqual(parseUnicodeRange(''), [])
})

test('usedCodePoints はタグと <style> を除いた表示文字だけを拾う', () => {
  const points = usedCodePoints('<svg><style>.a{fill:#fff}</style><text font-size="12">東 A1</text></svg>')
  assert.ok(points.has('東'.codePointAt(0)))
  assert.ok(points.has('A'.codePointAt(0)))
  assert.ok(!points.has('#'.codePointAt(0)), 'style の中身は数えない')
  assert.ok(!points.has('f'.codePointAt(0)), '属性値は数えない')
})

test('selectFaces は使用文字と交差するチャンクだけ選ぶ', () => {
  const faces = parseFontFaces(CSS_FIXTURE)
  const picked = selectFaces(faces, usedCodePoints('<text>東 A</text>'))
  assert.deepEqual(picked.map((f) => f.url.split('/').at(-1)), ['latin.woff2', 'jp102.woff2'])
})

test('buildEmbeddedFontCss → embedFontsInSvg で data: の @font-face が svg に入る', async () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>東 A</text></svg>'
  const loads = []
  const options = {
    loadCss: async () => CSS_FIXTURE,
    loadFont: async (url) => {
      loads.push(url.split('/').at(-1))
      return 'data:font/woff2;base64,QUJD'
    },
  }
  const css = await buildEmbeddedFontCss(svg, options)
  assert.match(css, /font-family:'Roboto Condensed';font-style:normal;font-weight:100 900/)
  assert.match(css, /unicode-range:U\+0-ff,U\+2013-2014/)
  assert.match(css, /src:url\(data:font\/woff2;base64,QUJD\) format\('woff2'\)/)
  assert.deepEqual(loads.sort(), ['jp102.woff2', 'latin.woff2'], '交差しないチャンクは取得しない')

  const out = await embedFontsInSvg(svg, options)
  assert.match(out, /^<svg[^>]*><style>@font-face/)
  assert.match(out, /<\/style><text>東 A<\/text>/)
})

test('buildFontFaceCss は取得できなかった face を黙って飛ばす', () => {
  const faces = parseFontFaces(CSS_FIXTURE)
  const css = buildFontFaceCss(faces, new Map([[faces[0].url, 'data:font/woff2;base64,QUJD']]))
  assert.match(css, /Roboto Condensed/)
  assert.ok(!css.includes('Noto Sans JP'))
})

test('tryEmbedFontsInSvg は失敗時に元の svg を返し log に残す', async () => {
  const svg = '<svg><text>あ</text></svg>'
  const logs = []
  const out = await tryEmbedFontsInSvg(svg, {
    log: (m) => logs.push(m),
    loadCss: async () => {
      throw new Error('offline')
    },
  })
  assert.equal(out, svg)
  assert.match(logs[0], /フォント埋め込みに失敗/)
})
