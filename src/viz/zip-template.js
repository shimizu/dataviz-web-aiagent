// zip に同梱するファイルのテンプレートとデータ直列化（純関数）。
//
// 役割: 「ダブルクリックで開けば同じ図が出る」zip の中身を組み立てる。**file:// で開いても動くこと**が要件なので、
//       fetch を使わず、データは `data/datasets.js`（window.__DATASETS__ への代入）として同梱し、
//       ライブラリ（viz-runtime.js）も実ファイルで入れる（CDN 参照しない）。
//       classic script の <script src> なら file:// でも読める（ES モジュールは CORS で読めない）。
// 関係: zip-export.js が fflate へ渡す前にここで文字列を作る。App が runtime のソースを fetch して渡す。

// Float32Array 等 → base64（環境非依存。btoa の呼び出しスタック制限も避ける）。
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
export function bytesToBase64(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes.buffer ?? bytes)
  let out = ''
  for (let i = 0; i < view.length; i += 3) {
    const a = view[i]
    const b = view[i + 1]
    const c = view[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

// データセット（Runtime 形）→ JSON に載る形。Float32Array は base64 に、
// geojson の features と records の二重化は復元側で解く。
export function toSerializableDataset(ds) {
  const base = { id: ds.id, name: ds.name, kind: ds.kind, columns: ds.columns ?? [] }
  if (ds.kind === 'geojson') {
    return { ...base, geojson: ds.geojson, metadata: stripHeavy(ds.metadata) }
  }
  if (ds.kind === 'raster') {
    const raster = ds.raster ?? {}
    return {
      ...base,
      raster: {
        width: raster.width,
        height: raster.height,
        bbox: raster.bbox,
        crs: raster.crs,
        nodata: raster.nodata ?? null,
        bands: (raster.bands ?? []).map((b) => ({ __f32: bytesToBase64(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)) })),
      },
      metadata: stripHeavy(ds.metadata),
    }
  }
  return { ...base, records: ds.records ?? [], metadata: stripHeavy(ds.metadata) }
}

// metadata に入れている本体（geojson / raster）は二重に書き出さない（復元側で入れ直す）。
const HEAVY_KEYS = new Set(['geojson', 'raster'])
function stripHeavy(metadata = {}) {
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !HEAVY_KEYS.has(key)))
}

// data/datasets.js の中身。
export function buildDatasetsScript(datasets) {
  const payload = datasets.map(toSerializableDataset)
  return `// このファイルは自動生成です。可視化に使ったデータを保持します。
window.__DATASETS__ = (function () {
  function f32(base64) {
    var binary = atob(base64)
    var bytes = new Uint8Array(binary.length)
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new Float32Array(bytes.buffer)
  }
  var list = ${JSON.stringify(payload)}
  var out = {}
  for (var i = 0; i < list.length; i += 1) {
    var d = list[i]
    if (d.kind === 'geojson') {
      d.records = (d.geojson && d.geojson.features) || []
      d.raster = null
    } else if (d.kind === 'raster') {
      d.raster.bands = d.raster.bands.map(function (b) { return f32(b.__f32) })
      d.records = []
      d.geojson = null
    } else {
      d.geojson = null
      d.raster = null
    }
    d.metadata = d.metadata || {}
    d.metadata.geojson = d.geojson
    d.metadata.raster = d.raster
    out[d.id] = d
  }
  return out
})()
`
}

// viz.js の中身（生成された render 関数 + 起動コード）。
export function buildVizScript({ code, width, height, theme }) {
  return `// このファイルは自動生成です。上半分が描画コード、下半分が起動コードです。
${String(code ?? '').trim()}

;(function () {
  var container = document.getElementById('viz')
  var theme = ${JSON.stringify(theme ?? {})}
  function start() {
    try {
      Promise.resolve(
        render({
          container: container,
          d3: window.d3,
          Plot: window.Plot,
          turf: window.turf,
          geoWarp: window.geoWarp,
          pretext: window.pretext,
          datasets: window.__DATASETS__,
          width: ${Number(width) || 960},
          height: ${Number(height) || 600},
          theme: theme,
        }),
      ).then(fixNestedSvg).catch(showError)
    } catch (error) {
      showError(error)
    }
  }
  // 入れ子 svg（Plot など）の内部 <style> が width / height 属性を CSS で上書きして内容がずれるのを防ぐ
  // （フレーム側 viz-frame.js の normalizeSvg と同じ補正）。
  function fixNestedSvg() {
    var nested = container.querySelectorAll('svg svg')
    for (var i = 0; i < nested.length; i += 1) {
      var el = nested[i]
      if (el.getAttribute('width') && !el.style.width) el.style.width = el.getAttribute('width') + 'px'
      if (el.getAttribute('height') && !el.style.height) el.style.height = el.getAttribute('height') + 'px'
      if (!el.style.maxWidth) el.style.maxWidth = 'none'
    }
  }
  function showError(error) {
    container.textContent = '描画に失敗しました: ' + (error && error.message ? error.message : String(error))
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start)
  else start()
})()
`
}

// index.html の中身。
export function buildIndexHtml({ title, description, generatedAt, hasFontCss = false }) {
  const escape = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escape(title)}</title>
    <link rel="stylesheet" href="./style.css" />${hasFontCss ? '\n    <link rel="stylesheet" href="./fonts.css" />' : ''}
  </head>
  <body>
    <figure class="viz-figure">
      <div id="viz"></div>
      ${description ? `<figcaption>${escape(description)}</figcaption>` : ''}
    </figure>
    <p class="viz-generated">生成: ${escape(generatedAt)}</p>
    <!-- ライブラリ・データ・描画コードの順に読み込む（file:// でも動くよう classic script にしている） -->
    <script src="./viz-runtime.js"></script>
    <script src="./data/datasets.js"></script>
    <script src="./viz.js"></script>
  </body>
</html>
`
}

// style.css の中身。
export function buildStyleCss(theme = {}) {
  const font = theme.font?.family ?? 'system-ui, sans-serif'
  const background = theme.colors?.background ?? '#ffffff'
  const text = theme.colors?.text ?? '#111827'
  const muted = theme.colors?.mutedText ?? '#6b7280'
  return `/* このファイルは自動生成です。図の周囲（ページ）のスタイルだけを持ちます。 */
body {
  margin: 0;
  padding: 24px;
  background: ${background};
  color: ${text};
  font-family: ${font};
}
.viz-figure {
  margin: 0 auto;
  max-width: max-content;
}
#viz svg {
  display: block;
  max-width: 100%;
  height: auto;
}
figcaption {
  margin-top: 8px;
  font-size: 13px;
  color: ${muted};
}
.viz-generated {
  margin: 16px auto 0;
  max-width: max-content;
  font-size: 11px;
  color: ${muted};
}
`
}

// README.txt の中身。
export function buildReadme({ title, datasets, generatedAt, fileNames }) {
  const list = datasets.map((d) => `  - ${d.id} (${d.kind}): ${d.name}`).join('\n')
  return `${title}

このフォルダはデータ可視化エージェントが書き出したものです。生成日時: ${generatedAt}

■ 開き方
  index.html をブラウザで開いてください（ダブルクリックで開けます）。
  インターネット接続は不要です。ライブラリ（viz-runtime.js）も同梱しています。

■ 中身
${fileNames.map((n) => `  - ${n}`).join('\n')}

■ 使ったデータ
${list || '  （なし）'}

■ 手を入れるとき
  viz.js の上半分が描画コード（render 関数）です。d3 / Plot / turf / geoWarp / pretext が
  グローバルに読み込まれた状態で呼ばれます。data/datasets.js は自動生成なので
  直接編集せず、data/ 内の元ファイルから作り直すことをおすすめします。
`
}
