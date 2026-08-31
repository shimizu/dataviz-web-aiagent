// viz-runtime のエントリ: 可視化フレームと zip 書き出しの両方で使うライブラリ束をグローバルに載せる。
//
// 役割: d3（+ d3-geo-projection + d3-geo-polygon をマージ）/ turf / geoWarp / pretext（テキスト計測）を window に公開する IIFE。
//       vite.runtime.config.js で public/viz-runtime.js にビルドし、public/viz-frame.html の <script src> と
//       zip 同梱（viz-runtime.js）で同じファイルを使う。アプリ本体（src/main.jsx）からは import しない。
// 関係: geo-warp.js。マージ順は d3 → geo-projection → geo-polygon（polygon が polyhedral 系を意図的に上書きする）。
import * as d3 from 'd3'
import * as d3GeoProjection from 'd3-geo-projection'
import * as d3GeoPolygon from 'd3-geo-polygon'
import * as turf from '@turf/turf'
// pretext: DOM リフローなしのテキスト計測・折り返し（canvas measureText + Intl.Segmenter）。ラベル幅の実測と注釈の複数行化に使う。
import * as pretext from '@chenglou/pretext'

import { geoWarp } from './geo-warp.js'

export const VIZ_RUNTIME_VERSION = '2'

const scope = globalThis
scope.d3 = Object.assign({}, d3, d3GeoProjection, d3GeoPolygon)
scope.turf = turf
scope.geoWarp = geoWarp
scope.pretext = pretext
scope.VIZ_RUNTIME_VERSION = VIZ_RUNTIME_VERSION
