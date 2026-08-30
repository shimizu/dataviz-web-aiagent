// CSV / TSV のパースと列プロファイル（純関数）。
//
// 役割: 区切りテキストを { columns, records, rowCount } に正規化する。列の型（number / date / boolean / string）を
//       推定し、number と boolean だけ値を変換する。**date は原文の文字列のまま残す**
//       （JSON / structured clone / zip 書き出しで形が変わらないようにするため。描画側で d3.utcParse する）。
// 関係: import-files.js が呼ぶ。dataset-shapes.js の tabular 保存形を作る。
//
// CSP 上の注意: d3-dsv の `parse()` は行オブジェクトを作るのに **new Function を使う**ため、
//   本番の CSP（script-src 'self'・'unsafe-eval' なし）ではメインスレッドで例外になる。
//   引用符処理だけ借りて自前で組み立てられる `parseRows()` を使うこと（dev は CSP 非適用なので気付けない）。
import { dsvFormat } from 'd3-dsv'

export const MAX_TABULAR_ROWS = 200_000
const MAX_UNIQUE_TRACKED = 10_000
const NULL_TOKENS = new Set(['', 'na', 'n/a', 'null', 'nan', '-', '--', '欠損', '不明'])
const TRUE_TOKENS = new Set(['true', 'yes', 'y', '1', '真'])
const FALSE_TOKENS = new Set(['false', 'no', 'n', '0', '偽'])
// 日付とみなす形（ISO 中心。曖昧な m/d/y は数値と誤認しやすいので採らない）。
const DATE_PATTERNS = [
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/,
  /^\d{4}\/\d{1,2}\/\d{1,2}$/,
  /^\d{4}-\d{2}$/,
  /^\d{4}年\d{1,2}月(\d{1,2}日)?$/,
]

export function isNullToken(value) {
  return value == null || NULL_TOKENS.has(String(value).trim().toLowerCase())
}

// 桁区切り・通貨記号・パーセントは数値として読む（末尾 % は 1/100 にしない。単位は列名に任せる）。
export function parseNumber(raw) {
  const text = String(raw).trim().replace(/[,\s￥$€£]/g, '').replace(/%$/, '')
  if (text === '' || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

export function isDateLike(value) {
  const text = String(value).trim()
  return DATE_PATTERNS.some((re) => re.test(text))
}

// 列の値（文字列）の並びから型を推定する。空値は判定から除く。
export function inferColumnType(values) {
  let filled = 0
  let numbers = 0
  let dates = 0
  let booleans = 0
  for (const v of values) {
    if (isNullToken(v)) continue
    filled += 1
    const text = String(v).trim().toLowerCase()
    if (isDateLike(v)) dates += 1
    else if (parseNumber(v) != null) numbers += 1
    if (TRUE_TOKENS.has(text) || FALSE_TOKENS.has(text)) booleans += 1
  }
  if (filled === 0) return 'string'
  const ratio = (n) => n / filled
  if (ratio(dates) >= 0.9) return 'date'
  // 0/1 だけの列は数値として扱う（真偽は true/false・yes/no のときだけ）
  if (ratio(booleans) >= 0.95 && ratio(numbers) < 0.95) return 'boolean'
  if (ratio(numbers) >= 0.9) return 'number'
  return 'string'
}

function coerce(value, type) {
  if (isNullToken(value)) return null
  if (type === 'number') return parseNumber(value)
  if (type === 'boolean') {
    const text = String(value).trim().toLowerCase()
    if (TRUE_TOKENS.has(text)) return true
    if (FALSE_TOKENS.has(text)) return false
    return null
  }
  return String(value).trim()
}

// 変換後の値からプロファイルを作る（min / max / uniqueCount / topValues など）。
export function profileColumn(name, type, values) {
  const profile = { name, type, nullCount: 0, examples: [] }
  let min = null
  let max = null
  let sum = 0
  let count = 0
  const counts = new Map()
  for (const v of values) {
    if (v == null) {
      profile.nullCount += 1
      continue
    }
    if (profile.examples.length < 3) profile.examples.push(v)
    if (type === 'number') {
      if (min == null || v < min) min = v
      if (max == null || v > max) max = v
      sum += v
      count += 1
    } else {
      const key = String(v)
      if (min == null || key < min) min = key
      if (max == null || key > max) max = key
      if (counts.size < MAX_UNIQUE_TRACKED) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  if (min != null) profile.min = min
  if (max != null) profile.max = max
  if (type === 'number' && count > 0) profile.mean = Number((sum / count).toFixed(6))
  if (type !== 'number') {
    profile.uniqueCount = counts.size
    profile.uniqueTruncated = counts.size >= MAX_UNIQUE_TRACKED
    profile.topValues = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([value, n]) => ({ value, count: n }))
  }
  return profile
}

// 区切り文字を推定する（先頭数行で数が安定している方を採る）。
export function detectDelimiter(text, fileName = '') {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.tsv') || lower.endsWith('.tab')) return '\t'
  if (lower.endsWith('.csv')) return ','
  const head = text.slice(0, 4000).split(/\r?\n/).slice(0, 5)
  const score = (d) => head.reduce((acc, line) => acc + (line.split(d).length - 1), 0)
  return score('\t') > score(',') ? '\t' : ','
}

// 区切りテキスト → { columns, records, rowCount, truncated, warnings }
export function parseDelimitedText(text, { fileName = '', delimiter, maxRows = MAX_TABULAR_ROWS } = {}) {
  const body = String(text ?? '').replace(/^\uFEFF/, '')
  if (!body.trim()) throw new Error('ファイルが空です。ヘッダー行と 1 行以上のデータが必要です')
  const sep = delimiter ?? detectDelimiter(body, fileName)
  // parseRows は行を配列で返す（new Function を使わない = CSP セーフ）。
  const table = dsvFormat(sep).parseRows(body)
  const names = (table[0] ?? []).map((n, i) => String(n ?? '').trim() || `列${i + 1}`)
  if (names.length === 0) throw new Error('ヘッダー行を読み取れませんでした（1 行目に列名が必要です）')

  const warnings = []
  const dataRows = table.slice(1)
  const truncated = dataRows.length > maxRows
  const used = truncated ? dataRows.slice(0, maxRows) : dataRows
  if (truncated) warnings.push(`${dataRows.length} 行のうち先頭 ${maxRows} 行だけを読み込みました（上限 ${maxRows} 行）`)

  const raw = names.map((_, i) => used.map((row) => row[i]))
  const types = names.map((name, i) => inferColumnType(raw[i].slice(0, 2000).length > 0 ? raw[i] : [name]))
  const converted = names.map((_, i) => raw[i].map((v) => coerce(v, types[i])))
  const records = used.map((_, r) => {
    const record = {}
    names.forEach((name, i) => {
      record[name] = converted[i][r]
    })
    return record
  })
  const columns = names.map((name, i) => profileColumn(name, types[i], converted[i]))
  const generated = names.filter((n) => /^列\d+$/.test(n)).length
  if (generated > 0) warnings.push(`列名が空だった列が ${generated} 個あります（列1 のような仮の名前を付けました）`)

  return { columns, records, rowCount: records.length, truncated, warnings }
}
