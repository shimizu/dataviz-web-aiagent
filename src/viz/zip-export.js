// 可視化を zip（html / js / css / データ）として書き出す。
//
// 役割: zip-template.js が作った文字列と、ライブラリ本体・元データファイルをまとめて fflate で圧縮する。
//       ファイル一覧の組み立て（buildZipFiles）はブラウザ非依存の純関数なのでテストできる。
//       圧縮そのものは非同期版 `zip` を使い、大きなデータでも UI を止めない。
// 関係: App の DL ボタン。ライブラリのソースは App が fetch(BASE_URL + 'viz-runtime.js') で取ってきて渡す。
import { zip } from 'fflate'

import { toFileName } from './svg-export.js'
import { normalizeSvgForExport } from './svg-export.js'
import { buildDatasetsScript, buildIndexHtml, buildReadme, buildStyleCss, buildVizScript } from './zip-template.js'

// 元データのファイル名（重複したら連番を付ける）。
function uniqueName(used, name) {
  const safe = String(name ?? 'data').replace(/[\\/:*?"<>|]/g, '_')
  if (!used.has(safe)) {
    used.add(safe)
    return safe
  }
  const dot = safe.lastIndexOf('.')
  const base = dot > 0 ? safe.slice(0, dot) : safe
  const ext = dot > 0 ? safe.slice(dot) : ''
  let i = 2
  while (used.has(`${base}_${i}${ext}`)) i += 1
  const next = `${base}_${i}${ext}`
  used.add(next)
  return next
}

// zip に入れるファイル一覧を作る（純関数）。値は文字列か Uint8Array。
export function buildZipFiles({ viz, version, datasets = [], originals = [], runtimeSource = '', theme = {}, fontCss = '', now = new Date() }) {
  if (!viz || !version) throw new Error('書き出す可視化がありません')
  const generatedAt = now.toISOString().replace('T', ' ').slice(0, 19)
  const files = {}

  files['viz.js'] = buildVizScript({ code: version.code, width: version.width, height: version.height, theme })
  files['style.css'] = buildStyleCss(theme)
  // Web フォントの data: 埋め込み CSS（CDN 参照なしで file:// でもフォントが出る。無ければシステムフォント）
  if (fontCss) files['fonts.css'] = fontCss
  files['data/datasets.js'] = buildDatasetsScript(datasets)
  files['viz.svg'] = withFontStyle(
    normalizeSvgForExport(version.svg, { width: version.width, height: version.height }),
    fontCss,
  )
  if (runtimeSource) files['viz-runtime.js'] = runtimeSource

  // 元データ（あれば）。zip から元の csv / geojson を取り出せるようにする。
  const used = new Set()
  for (const original of originals) {
    if (!original) continue
    const name = uniqueName(used, original.name)
    const content = original.text ?? original.buffer
    if (content == null) continue
    files[`data/${name}`] = typeof content === 'string' ? content : new Uint8Array(content)
  }

  files['index.html'] = buildIndexHtml({ title: viz.title, description: viz.description, generatedAt, hasFontCss: Boolean(fontCss) })
  files['README.txt'] = buildReadme({ title: viz.title, datasets, generatedAt, fileNames: Object.keys(files).sort() })
  return files
}

// 単体の viz.svg にもフォントを効かせる（<svg> 開始タグ直後に <style> を注入。fontCss 無しなら素通し）。
function withFontStyle(svg, fontCss) {
  if (!fontCss) return svg
  const open = /<svg\b[^>]*>/i.exec(svg)
  if (!open) return svg
  return svg.replace(open[0], `${open[0]}<style>${fontCss}</style>`)
}

// 文字列を Uint8Array に揃える。
function toBytes(value) {
  if (value instanceof Uint8Array) return value
  return new TextEncoder().encode(String(value))
}

// zip の Blob を作る（ブラウザ）。zipImpl はテストの注入点。
export async function createZipBlob(files, { zipImpl = zip, level = 6 } = {}) {
  const entries = Object.fromEntries(Object.entries(files).map(([name, value]) => [name, toBytes(value)]))
  const data = await new Promise((resolve, reject) => {
    zipImpl(entries, { level }, (err, out) => (err ? reject(err) : resolve(out)))
  })
  return new Blob([data], { type: 'application/zip' })
}

export function zipFileName(title) {
  return toFileName(title, 'zip')
}
