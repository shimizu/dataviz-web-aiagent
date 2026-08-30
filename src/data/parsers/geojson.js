// GeoJSON の正規化・診断・プロパティのプロファイル（純関数。turf は必要なときだけ動的 import）。
//
// 役割: 入力を FeatureCollection に揃え、bbox・地物数・ジオメトリ種別・頂点数・プロパティの型を求め、
//       「D3 で描けない典型パターン」を診断メッセージにする（reference/d3_geojson_turf_rendering_guide.md §2〜§16）。
//       **座標は自動で書き換えない**（turf.flip / toWgs84 / unkinkPolygon の無条件適用は同ガイド §14 が禁じている）。
//       診断を describe_dataset で Claude に見せ、必要な修正は描画コード側で選ばせる。
// 関係: import-files.js が呼ぶ。頂点数が多いときだけ表示用の簡略版を作る（原本は保持）。
import { inferColumnType, profileColumn } from './tabular.js'

export const MAX_GEOJSON_BYTES = 20 * 1024 * 1024
// これを超えたら表示用に簡略化した副本を作る（描画の実用速度のため。集計は原本を使う）。
export const SIMPLIFY_VERTEX_THRESHOLD = 300_000

// 入力（FeatureCollection / Feature / Geometry / 配列）を FeatureCollection に揃える。
export function toFeatureCollection(input) {
  if (!input || typeof input !== 'object') throw new Error('GeoJSON として読めません（オブジェクトではありません）')
  if (Array.isArray(input)) return { type: 'FeatureCollection', features: input }
  if (input.type === 'FeatureCollection') {
    if (!Array.isArray(input.features)) throw new Error('FeatureCollection に features 配列がありません')
    return input
  }
  if (input.type === 'Feature') return { type: 'FeatureCollection', features: [input] }
  if (typeof input.type === 'string' && (input.coordinates || input.geometries)) {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: input }] }
  }
  throw new Error(`GeoJSON の type が不正です: ${String(input.type)}（FeatureCollection / Feature / Geometry のいずれか）`)
}

// ジオメトリの座標を 1 つずつ渡す。
function eachPosition(geometry, visit) {
  if (!geometry) return
  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries ?? []) eachPosition(g, visit)
    return
  }
  const walk = (coords, depth) => {
    if (!Array.isArray(coords)) return
    if (depth === 0) {
      visit(coords)
      return
    }
    for (const c of coords) walk(c, depth - 1)
  }
  const depth = { Point: 0, MultiPoint: 1, LineString: 1, MultiLineString: 2, Polygon: 2, MultiPolygon: 3 }[geometry.type]
  if (depth == null) return
  walk(geometry.coordinates, depth)
}

// ポリゴンの外周リングを 1 つずつ渡す。
function eachExteriorRing(geometry, visit) {
  if (!geometry) return
  if (geometry.type === 'GeometryCollection') {
    for (const g of geometry.geometries ?? []) eachExteriorRing(g, visit)
    return
  }
  if (geometry.type === 'Polygon') visit(geometry.coordinates?.[0])
  else if (geometry.type === 'MultiPolygon') for (const poly of geometry.coordinates ?? []) visit(poly?.[0])
}

// 平面での符号付き面積（正 = 反時計回り = RFC 7946 の外周）。
export function ringSignedArea(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0
  let sum = 0
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[i + 1]
    sum += x1 * y2 - x2 * y1
  }
  return sum / 2
}

// 1 パスで統計と診断のもとになる数を集める。
export function inspectFeatureCollection(fc) {
  let vertexCount = 0
  let invalidCount = 0
  let outOf180 = 0
  let outOf90 = 0
  let latOver90 = 0
  let clockwiseExterior = 0
  let exteriorRings = 0
  const geometryTypes = new Set()
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity

  for (const feature of fc.features ?? []) {
    const geometry = feature?.geometry
    if (!geometry) continue
    if (geometry.type === 'GeometryCollection') geometryTypes.add('GeometryCollection')
    else if (geometry.type) geometryTypes.add(geometry.type)
    eachPosition(geometry, (pos) => {
      vertexCount += 1
      const x = Number(pos?.[0])
      const y = Number(pos?.[1])
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        invalidCount += 1
        return
      }
      if (Math.abs(x) > 180) outOf180 += 1
      if (Math.abs(y) > 90) {
        outOf90 += 1
        latOver90 += 1
      }
      if (x < west) west = x
      if (x > east) east = x
      if (y < south) south = y
      if (y > north) north = y
    })
    eachExteriorRing(geometry, (ring) => {
      if (!ring) return
      exteriorRings += 1
      if (ringSignedArea(ring) < 0) clockwiseExterior += 1
    })
  }

  const bbox = Number.isFinite(west) ? [west, south, east, north] : null
  return { vertexCount, invalidCount, outOf180, outOf90, latOver90, clockwiseExterior, exteriorRings, geometryTypes: [...geometryTypes], bbox }
}

// 診断メッセージ（描画前に確認すべきこと）。修正はしない。
export function buildDiagnostics(info) {
  const messages = []
  if (info.invalidCount > 0) {
    messages.push(`NaN / null の座標が ${info.invalidCount} 点あります。描画前に取り除くか、該当地物を除外してください`)
  }
  if (info.outOf180 > 0 || info.latOver90 > 0) {
    messages.push(
      `経緯度の範囲外の座標があります（|経度|>180: ${info.outOf180} 点、|緯度|>90: ${info.latOver90} 点）。` +
        'EPSG:3857 などの投影済み座標の可能性が高い。d3.geoIdentity().reflectY(true).fitSize(...) で描くか、事前に EPSG:4326 へ変換してください',
    )
  } else if (info.bbox && Math.abs(info.bbox[1]) <= 90 && Math.abs(info.bbox[3]) <= 90 && Math.abs(info.bbox[0]) <= 90 && Math.abs(info.bbox[2]) <= 90) {
    // 経度が ±90 に収まる = [lat, lon] 逆順の疑い（判定できないので注意喚起にとどめる）
    messages.push('経度が ±90 の範囲に収まっています。[緯度, 経度] の順で格納されている可能性があるので、サンプル座標が実際の位置と合うか確認してください')
  }
  if (info.clockwiseExterior > 0) {
    messages.push(
      `外周リングが時計回りの Polygon が ${info.clockwiseExterior} / ${info.exteriorRings} 件あります。` +
        'd3 は球面の巻き方向で内外を決めるため、地球全体が塗られることがあります。turf.rewind(fc, { reverse: true }) で直してください',
    )
  }
  if (info.bbox && info.bbox[2] - info.bbox[0] > 180) {
    messages.push('bbox の経度幅が 180 度を超えています。日付変更線を跨ぐ地物があると横に伸びた図形が出ることがあります')
  }
  return messages
}

function buildPropertiesSchema(features) {
  const names = new Set()
  for (const f of features) for (const key of Object.keys(f?.properties ?? {})) names.add(key)
  return [...names].map((name) => {
    const raw = features.map((f) => f?.properties?.[name])
    const type = inferColumnType(raw.map((v) => (v == null ? '' : String(v))))
    const values = raw.map((v) => {
      if (v == null || v === '') return null
      if (type === 'number') return typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''))
      if (type === 'boolean') return typeof v === 'boolean' ? v : String(v).toLowerCase() === 'true'
      return String(v)
    })
    return profileColumn(name, type, values)
  })
}

// 表示用の簡略版（頂点が多いときだけ）。turf は動的 import（初期チャンクに入れない）。
async function simplifyForDisplay(fc, vertexCount) {
  if (vertexCount <= SIMPLIFY_VERTEX_THRESHOLD) return null
  try {
    const turf = await import('@turf/turf')
    const tolerance = vertexCount > 1_000_000 ? 0.01 : 0.002
    return turf.simplify(structuredClone(fc), { tolerance, highQuality: false, mutate: true })
  } catch {
    return null
  }
}

// GeoJSON テキスト / オブジェクト → 保存形。
export async function parseGeoJson(input, { name = '' } = {}) {
  const source = typeof input === 'string' ? JSON.parse(input) : input
  const featureCollection = toFeatureCollection(source)
  const features = featureCollection.features ?? []
  if (features.length === 0) throw new Error('地物が 0 件です（features が空）')
  const info = inspectFeatureCollection(featureCollection)
  const displayFeatureCollection = await simplifyForDisplay(featureCollection, info.vertexCount)
  return {
    kind: 'geojson',
    name,
    featureCollection,
    displayFeatureCollection,
    featureCount: features.length,
    geometryTypes: info.geometryTypes,
    bbox: info.bbox,
    vertexCount: info.vertexCount,
    propertiesSchema: buildPropertiesSchema(features),
    diagnostics: buildDiagnostics(info),
  }
}
