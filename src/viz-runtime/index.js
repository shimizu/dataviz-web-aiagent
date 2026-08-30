// viz-runtime のエントリ: 可視化フレームと zip 書き出しの両方で使うライブラリ束をグローバルに載せる。
//
// 役割: d3（+ d3-geo-projection + d3-geo-polygon をマージ）/ turf / geoWarp を window に公開する IIFE。
//       vite.runtime.config.js で public/viz-runtime.js にビルドし、public/viz-frame.html の <script src> と
//       zip 同梱（viz-runtime.js）で同じファイルを使う。アプリ本体（src/main.jsx）からは import しない。
// 関係: geo-warp.js。マージ順は d3 → geo-projection → geo-polygon（polygon が polyhedral 系を意図的に上書きする）。
import * as d3 from 'd3'
import * as d3GeoProjection from 'd3-geo-projection'
import * as d3GeoPolygon from 'd3-geo-polygon'
import * as turf from '@turf/turf'

import { geoWarp } from './geo-warp.js'

export const VIZ_RUNTIME_VERSION = '1'

const scope = globalThis
scope.d3 = Object.assign({}, d3, d3GeoProjection, d3GeoPolygon)
scope.turf = turf
scope.geoWarp = geoWarp
scope.VIZ_RUNTIME_VERSION = VIZ_RUNTIME_VERSION
