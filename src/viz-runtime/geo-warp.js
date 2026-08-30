// geoWarp: ラスタ（GeoTIFF 由来の Float32Array バンド）を d3 の投影へ再投影して canvas / ImageData に描く。
//
// 役割: 生成コード（render）から `geoWarp().raster(ds.raster).projection(proj).size([w, h]).color(fn).toDataURL()` の形で使う
//       ビルダー。出力ピクセルごとに projection.invert で逆引きし、raster-paint.js の純粋ループで塗る。
//       invert の往復誤差（球の外側など）は round-trip 検査で捨て、mask（既定 Sphere、GeoJSON 可）で範囲を絞る。
// 関係: viz-runtime/index.js が window.geoWarp として公開。raster-paint.js（純関数）に依存。
// 流用元: reference/d3_raster_reprojection_in_d3（rasmuse/d3-geo-warp）の API 形。実装は書き直し。
import { geoContains } from 'd3-geo'
import { color as parseColor } from 'd3-color'

import { buildColorLut, computeDomain, lonLatToMercator, paintRaster } from './raster-paint.js'

const SPHERE = { type: 'Sphere' }

// CRS ごとの「経緯度 → ラスタ座標」変換。未知の CRS は経緯度とみなす（呼び出し側で警告する）。
function sourceTransform(crs) {
  if (crs === 'EPSG:3857') return lonLatToMercator
  return null
}

// projection.invert を往復検査付きで包む。往復が 0.5px 以上ずれる点（球の外側・特異点）は null。
function roundTripInvert(projection) {
  return (x, y) => {
    const lonlat = projection.invert([x, y])
    if (!lonlat || !Number.isFinite(lonlat[0]) || !Number.isFinite(lonlat[1])) return null
    const back = projection(lonlat)
    if (!back || Math.abs(back[0] - x) > 0.5 || Math.abs(back[1] - y) > 0.5) return null
    return lonlat
  }
}

// color(value) の戻り値（CSS 文字列 / [r,g,b,a] / null）を RGBA 配列に揃える。
function normalizeColorFn(fn) {
  return (value) => {
    const c = fn(value)
    if (c == null) return null
    if (Array.isArray(c)) return c
    const parsed = parseColor(c)
    if (!parsed) return null
    const rgb = parsed.rgb()
    return [rgb.r, rgb.g, rgb.b, Math.round((rgb.opacity ?? 1) * 255)]
  }
}

function grayscale(domain) {
  const [min, max] = domain
  const span = max - min || 1
  return (v) => {
    const g = Math.round(((v - min) / span) * 255)
    return [g, g, g, 255]
  }
}

export function geoWarp() {
  let raster = null // { width, height, bbox, crs?, nodata?, bands: [Float32Array...] }
  let band = 0 // バンド番号か配列そのもの
  let projection = null
  let size = [960, 600]
  let colorFn = null // value → CSS 文字列 | [r,g,b,a]。未指定はグレースケール
  let domain = null // LUT の値域。未指定はバンドの min/max
  let interpolation = 'nearest'
  let mask = SPHERE
  let lutSteps = 256

  function warp() {
    return warp.toImageData()
  }

  const accessor = (get, set) =>
    function (value) {
      if (arguments.length === 0) return get()
      set(value)
      return warp
    }

  warp.raster = accessor(
    () => raster,
    (v) => {
      raster = v
    },
  )
  warp.band = accessor(
    () => band,
    (v) => {
      band = v
    },
  )
  warp.projection = accessor(
    () => projection,
    (v) => {
      projection = v
    },
  )
  warp.size = accessor(
    () => size,
    (v) => {
      size = [Math.max(1, Math.round(v[0])), Math.max(1, Math.round(v[1]))]
    },
  )
  warp.color = accessor(
    () => colorFn,
    (v) => {
      colorFn = v
    },
  )
  warp.domain = accessor(
    () => domain,
    (v) => {
      domain = v
    },
  )
  warp.interpolation = accessor(
    () => interpolation,
    (v) => {
      interpolation = v === 'bilinear' ? 'bilinear' : 'nearest'
    },
  )
  warp.mask = accessor(
    () => mask,
    (v) => {
      mask = v
    },
  )
  warp.lutSteps = accessor(
    () => lutSteps,
    (v) => {
      lutSteps = Math.max(2, Math.round(v))
    },
  )

  // DOM 非依存の本体。{ data: Uint8ClampedArray, width, height, domain, stats } を返す。
  warp.toImageData = () => {
    if (!raster || !raster.bbox || !raster.width || !raster.height) throw new Error('geoWarp: raster({ width, height, bbox, bands }) を先に指定してください')
    if (!projection || typeof projection.invert !== 'function') {
      throw new Error('geoWarp: projection には invert を持つ d3 投影を渡してください（geoAlbersUsa など invert の無い投影は使えません）')
    }
    const bandArray = typeof band === 'number' ? raster.bands?.[band] : band
    if (!bandArray || bandArray.length !== raster.width * raster.height) {
      throw new Error(`geoWarp: バンドが不正です（長さ ${bandArray?.length ?? 0}、期待 ${raster.width * raster.height}）`)
    }
    const nodata = raster.nodata ?? null
    const dom = domain ?? computeDomain(bandArray, nodata)
    const rgba = colorFn ? normalizeColorFn(colorFn) : grayscale(dom)
    const color = buildColorLut({ color: rgba, domain: dom, steps: lutSteps })
    const [width, height] = size
    const out = new Uint8ClampedArray(width * height * 4)
    const useMask = mask && mask !== SPHERE && mask.type !== 'Sphere'
    const stats = paintRaster({
      width,
      height,
      invert: roundTripInvert(projection),
      raster,
      band: bandArray,
      toSource: sourceTransform(raster.crs),
      interpolation,
      color,
      mask: useMask ? (lon, lat) => geoContains(mask, [lon, lat]) : null,
      nodata,
      out,
    })
    return { data: out, width, height, domain: dom, stats }
  }

  // canvas 2d コンテキストへ描く（ブラウザ専用）。
  warp.render = (ctx) => {
    const result = warp.toImageData()
    ctx.putImageData(new ImageData(result.data, result.width, result.height), 0, 0)
    return result
  }

  // 新しい canvas に描いて返す（ブラウザ専用）。
  warp.toCanvas = () => {
    const canvas = document.createElement('canvas')
    canvas.width = size[0]
    canvas.height = size[1]
    warp.render(canvas.getContext('2d'))
    return canvas
  }

  // SVG の <image href> に埋める data URL（ブラウザ専用）。
  warp.toDataURL = (type = 'image/png') => warp.toCanvas().toDataURL(type)

  return warp
}
