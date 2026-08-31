// 可視化フレーム（隔離 iframe）側のブリッジ。classic script（ビルドしない・import しない）。
//
// 役割: 親（src/viz/viz-frame-bridge.js）から postMessage で受けた生成コードを new Function で評価し、
//       render({ container, d3, Plot, turf, geoWarp, pretext, datasets, width, height, theme }) を呼んで、できた <svg> を文字列で返す。
//       データセットは Map にキャッシュし、render のたびに再送させない。console とエラーを捕捉して結果に添える。
// 関係: viz-runtime.js（window.d3 / turf / geoWarp）を先に読み込む。メッセージ種別は src/viz/frame-protocol.js の写し
//       （変更時は両方を直す。test/viz-frame-bridge.test.js が突き合わせる）。
;(function () {
  'use strict'

  var MSG = {
    READY: 'viz:ready',
    PUT_DATASET: 'viz:put-dataset',
    RENDER: 'viz:render',
    RESULT: 'viz:result',
    CLEAR: 'viz:clear',
  }
  var MAX_CONSOLE_ENTRIES = 50
  var MAX_CONSOLE_CHARS = 500
  var MAX_ELEMENTS = 20000
  var MAX_IMAGE_BYTES = 10 * 1024 * 1024
  var SVG_NS = 'http://www.w3.org/2000/svg'
  var XLINK_NS = 'http://www.w3.org/1999/xlink'

  var datasets = new Map()
  var consoleBuffer = []
  var lastError = null
  var chain = Promise.resolve()

  // --- console / エラー捕捉 ---
  function stringify(value) {
    if (typeof value === 'string') return value
    try {
      var text = JSON.stringify(value)
      return text === undefined ? String(value) : text
    } catch {
      return String(value)
    }
  }
  function pushConsole(level, args) {
    var text = Array.prototype.map.call(args, stringify).join(' ')
    if (text.length > MAX_CONSOLE_CHARS) text = text.slice(0, MAX_CONSOLE_CHARS) + '…'
    consoleBuffer.push({ level: level, text: text })
    if (consoleBuffer.length > MAX_CONSOLE_ENTRIES) consoleBuffer.shift()
  }
  var levels = ['log', 'info', 'warn', 'error', 'debug']
  levels.forEach(function (level) {
    var original = console[level]
    console[level] = function () {
      pushConsole(level, arguments)
      if (typeof original === 'function') original.apply(console, arguments)
    }
  })
  window.addEventListener('error', function (event) {
    lastError = event.error || new Error(event.message)
    pushConsole('error', [event.message])
  })
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason
    lastError = reason instanceof Error ? reason : new Error(String(reason))
    pushConsole('error', ['unhandledrejection: ' + (reason && reason.message ? reason.message : String(reason))])
  })

  function post(message) {
    window.parent.postMessage(message, '*')
  }

  function errorInfo(err) {
    var e = err instanceof Error ? err : new Error(String(err))
    var stack = typeof e.stack === 'string' ? e.stack.split('\n').slice(0, 4).join('\n') : ''
    return { message: e.message, stack: stack }
  }

  // --- SVG の正規化と警告 ---
  function normalizeSvg(svg, width, height) {
    if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', SVG_NS)
    var usesXlink = svg.querySelector('[*|href]') !== null && svg.innerHTML.indexOf('xlink:href') !== -1
    if (usesXlink && !svg.getAttribute('xmlns:xlink')) svg.setAttribute('xmlns:xlink', XLINK_NS)
    if (!svg.getAttribute('viewBox')) {
      var w = parseFloat(svg.getAttribute('width')) || width
      var h = parseFloat(svg.getAttribute('height')) || height
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h)
    }
    if (!svg.getAttribute('width')) svg.setAttribute('width', String(width))
    if (!svg.getAttribute('height')) svg.setAttribute('height', String(height))
    // 入れ子 svg（Plot の入れ子など）は、内部の <style>（例: Plot の height:auto / max-width:100%）が
    // width / height 属性を CSS で上書きし、preserveAspectRatio の中央寄せで内容がずれることがある。
    // 属性値をインラインスタイルへ焼き込んで属性どおりの寸法を強制する（インラインは :where() に必ず勝つ）。
    var nested = svg.querySelectorAll('svg')
    for (var i = 0; i < nested.length; i += 1) {
      var el = nested[i]
      var nw = el.getAttribute('width')
      var nh = el.getAttribute('height')
      if (nw && !el.style.width) el.style.width = nw + 'px'
      if (nh && !el.style.height) el.style.height = nh + 'px'
      if (!el.style.maxWidth) el.style.maxWidth = 'none'
    }
  }

  function collectWarnings(svg, width, height) {
    var warnings = []
    var all = svg.querySelectorAll('*')
    var elementCount = all.length
    if (elementCount === 0) warnings.push('svg が空です（子要素がありません）')
    if (elementCount > MAX_ELEMENTS) {
      warnings.push('svg の要素数が ' + elementCount + ' と多すぎます（' + MAX_ELEMENTS + ' 超）。集計・サンプリングか canvas 埋め込みを検討')
    }
    var badAttrs = 0
    var foreign = 0
    var external = 0
    var imageBytes = 0
    var limit = Math.min(elementCount, MAX_ELEMENTS)
    for (var i = 0; i < limit; i += 1) {
      var el = all[i]
      var tag = el.tagName.toLowerCase()
      if (tag === 'foreignobject') foreign += 1
      var attrs = el.attributes
      for (var j = 0; j < attrs.length; j += 1) {
        var value = attrs[j].value
        if (/\bNaN\b|\bundefined\b/.test(value)) badAttrs += 1
        var name = attrs[j].name
        if (name === 'href' || name === 'xlink:href') {
          if (/^(https?:)?\/\//.test(value) || value.indexOf('blob:') === 0) external += 1
          if (tag === 'image' && value.indexOf('data:') === 0) imageBytes += value.length
        }
      }
    }
    if (badAttrs > 0) warnings.push('属性に NaN / undefined を含む要素が ' + badAttrs + ' 個あります（スケールの domain や欠損値の処理を確認）')
    if (foreign > 0) warnings.push('<foreignObject> は PNG 書き出しで描画されません（' + foreign + ' 個）')
    if (external > 0) warnings.push('外部 URL / blob: を参照する href が ' + external + ' 個あります（data: で埋め込む）')
    if (imageBytes > MAX_IMAGE_BYTES) warnings.push('埋め込み画像の合計が ' + Math.round(imageBytes / 1024 / 1024) + 'MB と大きすぎます（解像度を下げる）')
    var sw = parseFloat(svg.getAttribute('width'))
    var sh = parseFloat(svg.getAttribute('height'))
    if ((sw && Math.abs(sw - width) > 1) || (sh && Math.abs(sh - height) > 1)) {
      warnings.push('svg のサイズ（' + sw + '×' + sh + '）が要求（' + width + '×' + height + '）と違います')
    }
    var textCount = svg.querySelectorAll('text').length
    if (textCount === 0) warnings.push('<text> がありません（タイトル・軸ラベル・凡例を確認）')
    if (!svg.querySelector('title')) warnings.push('<title> がありません（svg 直下に図の説明を入れる）')
    collectDesignWarnings(svg, warnings)
    return { warnings: warnings, elementCount: elementCount, textCount: textCount, imageCount: svg.querySelectorAll('image').length }
  }

  // --- デザイン検査（機械的に判定できるものだけ。誤検知しやすい規則は入れない） ---
  var MAX_LINT_TEXTS = 300

  function parseRgb(value) {
    var m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(value || '')
    if (!m) return null
    var a = m[4] === undefined ? 1 : parseFloat(m[4])
    if (a === 0) return null
    return { r: +m[1], g: +m[2], b: +m[3] }
  }

  function luminance(c) {
    return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
  }

  // 彩度のある色の色相を 12 バケツに量子化（ランプの濃淡は同じバケツに落ちる）
  function hueBucket(c) {
    var r = c.r / 255
    var g = c.g / 255
    var b = c.b / 255
    var max = Math.max(r, g, b)
    var min = Math.min(r, g, b)
    if (max - min < 0.15) return null // 無彩色は数えない
    var h
    if (max === r) h = ((g - b) / (max - min)) % 6
    else if (max === g) h = (b - r) / (max - min) + 2
    else h = (r - g) / (max - min) + 4
    h = (h * 60 + 360) % 360
    return Math.floor(h / 30)
  }

  function intersect(a, b) {
    var w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
    var h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
    return w > 2 && h > 2 ? w * h : 0
  }

  function collectDesignWarnings(svg, warnings) {
    try {
      var svgRect = svg.getBoundingClientRect()
      var texts = svg.querySelectorAll('text')

      // 1) 文字サイズ < 9px
      var tiny = 0
      for (var i = 0; i < texts.length; i += 1) {
        var fs = parseFloat(getComputedStyle(texts[i]).fontSize)
        if (fs && fs < 9) tiny += 1
      }
      if (tiny > 0) warnings.push('9px 未満の文字が ' + tiny + ' 個あります（theme.label.minFontSize 未満は読めない）')

      // 2) ラベルの重なりと端切れ（実測の描画矩形で判定）
      if (texts.length > MAX_LINT_TEXTS) {
        warnings.push('テキストが ' + texts.length + ' 個と多く、重なり検査をスキップしました（全点ラベルになっていないか確認）')
      } else {
        var boxes = []
        for (var t = 0; t < texts.length; t += 1) {
          var el = texts[t]
          if (el.textContent.trim() === '') continue
          var r = el.getBoundingClientRect()
          if (r.width === 0 || r.height === 0) continue
          boxes.push({ rect: r, text: el.textContent.trim().slice(0, 12), clip: el.ownerSVGElement })
        }
        var overlapPairs = 0
        var overlapExample = ''
        boxes.sort(function (a, b) {
          return a.rect.left - b.rect.left
        })
        for (var p = 0; p < boxes.length; p += 1) {
          for (var q = p + 1; q < boxes.length; q += 1) {
            if (boxes[q].rect.left >= boxes[p].rect.right) break
            var area = intersect(boxes[p].rect, boxes[q].rect)
            var smaller = Math.min(
              boxes[p].rect.width * boxes[p].rect.height,
              boxes[q].rect.width * boxes[q].rect.height,
            )
            if (smaller > 0 && area > smaller * 0.25) {
              overlapPairs += 1
              if (!overlapExample) overlapExample = '「' + boxes[p].text + '」と「' + boxes[q].text + '」'
            }
          }
        }
        if (overlapPairs > 0) {
          warnings.push('重なっているラベルが ' + overlapPairs + ' 組あります（例: ' + overlapExample + '）。ずらす / 隠す / 縁取りで対処')
        }
        var clipped = 0
        var clippedExample = ''
        for (var c = 0; c < boxes.length; c += 1) {
          // 外側 svg と、属している入れ子 svg（overflow: hidden）の両方ではみ出しを見る
          var bounds = boxes[c].clip && boxes[c].clip !== svg ? boxes[c].clip.getBoundingClientRect() : svgRect
          var rr = boxes[c].rect
          var out =
            rr.left < bounds.left - 2 || rr.right > bounds.right + 2 || rr.top < bounds.top - 2 || rr.bottom > bounds.bottom + 2 ||
            rr.left < svgRect.left - 2 || rr.right > svgRect.right + 2 || rr.top < svgRect.top - 2 || rr.bottom > svgRect.bottom + 2
          if (out) {
            clipped += 1
            if (!clippedExample) clippedExample = '「' + boxes[c].text + '」'
          }
        }
        if (clipped > 0) {
          warnings.push('端で切れているラベルが ' + clipped + ' 個あります（例: ' + clippedExample + '）。余白を広げるか位置を変える')
        }
      }

      // 3) 塗りの色相数 > 8（濃淡ランプは同一色相に落ちるので数えない）と、白背景の近白塗り
      var shapes = svg.querySelectorAll('path, rect, circle, ellipse, polygon')
      var hueSeen = {}
      var hueCount = 0
      var nearWhite = 0
      var svgArea = Math.max(1, svgRect.width * svgRect.height)
      var limit = Math.min(shapes.length, 2000)
      for (var s = 0; s < limit; s += 1) {
        var fill = parseRgb(getComputedStyle(shapes[s]).fill)
        if (!fill) continue
        var bucket = hueBucket(fill)
        if (bucket !== null && !hueSeen[bucket]) {
          hueSeen[bucket] = true
          hueCount += 1
        }
        if (luminance(fill) > 0.95) {
          var sr = shapes[s].getBoundingClientRect()
          // 背景レイヤー（svg の大半を覆う矩形）と極小の区切りは除外
          if (sr.width > 4 && sr.height > 4 && (sr.width * sr.height) / svgArea < 0.8) nearWhite += 1
        }
      }
      if (hueCount > 8) warnings.push('塗りの色相が ' + hueCount + ' 種類あります（系列色は 8 まで。上位 + その他に畳むか small multiples に）')
      if (nearWhite > 0) warnings.push('白背景に溶ける近白の塗りが ' + nearWhite + ' 個あります（theme の色を使う）')
    } catch (err) {
      // 検査自体の失敗で描画を壊さない（getBBox 不可の環境など）
    }
  }

  // --- 描画 ---
  function handleRender(request) {
    var requestId = request.requestId
    var width = request.width
    var height = request.height
    var started = performance.now()
    consoleBuffer = []
    lastError = null
    var container = document.getElementById('viz')
    container.innerHTML = ''
    container.style.width = width + 'px'
    container.style.height = height + 'px'

    return Promise.resolve()
      .then(function () {
        var ids = Array.isArray(request.datasetIds) ? request.datasetIds : []
        var missing = ids.filter(function (id) {
          return !datasets.has(id)
        })
        if (missing.length > 0) throw new Error('データセットがフレームに送られていません: ' + missing.join(', '))
        var ds = {}
        ids.forEach(function (id) {
          ds[id] = datasets.get(id)
        })
        var factory = new Function('"use strict";\n' + request.code + '\nreturn typeof render === "function" ? render : undefined;')
        var render = factory()
        if (typeof render !== 'function') throw new Error('render 関数が定義されていません（function render({ container, d3, ... }) を定義する）')
        return render({
          container: container,
          d3: window.d3,
          Plot: window.Plot,
          turf: window.turf,
          geoWarp: window.geoWarp,
          pretext: window.pretext,
          datasets: ds,
          width: width,
          height: height,
          theme: request.theme || {},
        })
      })
      .then(function () {
        if (lastError) throw lastError
        if (container.querySelector('figure')) {
          throw new Error(
            'container に <figure> があります。Plot の title / subtitle / caption / legend オプションは使わず、' +
              'タイトルと凡例は外側の svg に描いて Plot.plot() の svg を入れ子にする（単一 svg 契約）',
          )
        }
        var svg = container.querySelector('svg')
        if (!svg) throw new Error('container に <svg> がありません（render は container の中に svg を 1 つ作る）')
        normalizeSvg(svg, width, height)
        var info = collectWarnings(svg, width, height)
        var svgText = new XMLSerializer().serializeToString(svg)
        post({
          type: MSG.RESULT,
          requestId: requestId,
          ok: true,
          svg: svgText,
          warnings: info.warnings,
          console: consoleBuffer.slice(),
          stats: {
            elementCount: info.elementCount,
            textCount: info.textCount,
            imageCount: info.imageCount,
            svgBytes: svgText.length,
            durationMs: Math.round(performance.now() - started),
          },
        })
      })
      .catch(function (err) {
        post({
          type: MSG.RESULT,
          requestId: requestId,
          ok: false,
          error: errorInfo(err),
          warnings: [],
          console: consoleBuffer.slice(),
          stats: { durationMs: Math.round(performance.now() - started) },
        })
      })
  }

  function handleClear() {
    datasets.clear()
    var container = document.getElementById('viz')
    if (container) container.innerHTML = ''
    consoleBuffer = []
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) return
    var msg = event.data
    if (!msg || typeof msg.type !== 'string') return
    switch (msg.type) {
      case MSG.PUT_DATASET:
        if (msg.dataset && msg.dataset.id) datasets.set(msg.dataset.id, msg.dataset)
        break
      case MSG.RENDER:
        chain = chain.then(function () {
          return handleRender(msg)
        })
        break
      case MSG.CLEAR:
        handleClear()
        break
      default:
        break
    }
  })

  post({ type: MSG.READY, runtimeVersion: window.VIZ_RUNTIME_VERSION || null, hasD3: typeof window.d3 === 'object' })
})()
