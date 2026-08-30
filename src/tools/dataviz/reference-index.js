// リファレンスガイド（Markdown）を見出しで分割・検索する純関数。
//
// 役割: reference/*.md を「番号付きの節」に分け、read_reference ツールが目次と本文を返せるようにする。
//       ガイドは `#` / `##` の階層が途中で崩れている（`## 2.` の次が `# 3.` など）ため、見出しレベルだけでは
//       章（トップレベル）を判定できない。**番号の連続性 + 見出しレベルが浅くなる方向**で判定する:
//       整数番号が「直前の章 + 1」で、かつ見出しレベルがこれまでの章より深くなければ章、そうでなければ小節扱い
//       （§1 の中の「## 2. projection の…」「### 2. 色を…」、§17 の中の「## 1. coordinates を見る」、§66 の「## 1」を章と誤認しない）。
//       `4.1` のような小数番号は、現在の章の番号で始まるときだけ小節として番号を持つ。
// 関係: reference-handlers.js が使う。test/reference-index.test.js が実ファイルでも検証する。
const HEADING_RE = /^(#{1,4})\s+(.+?)\s*$/
const NUMBER_RE = /^(\d+(?:\.\d+)?)\.?\s+(.+)$/

export const DEFAULT_MAX_CHARS = 7000

// Markdown → { title, sections: [{ number, title, level: 'section'|'subsection', text }] }
export function splitSections(markdown) {
  const lines = String(markdown ?? '').split(/\r?\n/)
  const sections = []
  let docTitle = ''
  let current = null // 章
  let sub = null // 小節
  let expected = 1
  let chapterLevel = Infinity // これまでの章の最も浅い見出しレベル（深い見出しは章にしない）
  let inFence = false

  const flushSub = () => {
    if (sub) {
      sub.text = sub.text.join('\n').trim()
      delete sub.depth
      sub = null
    }
  }
  const flushSection = () => {
    flushSub()
    if (current) {
      current.text = current.text.join('\n').trim()
      current = null
    }
  }

  for (const line of lines) {
    if (/^```/.test(line)) inFence = !inFence
    const heading = inFence ? null : HEADING_RE.exec(line)
    if (!heading) {
      if (sub) sub.text.push(line)
      if (current) current.text.push(line)
      continue
    }
    const [, hashes, text] = heading
    const numbered = NUMBER_RE.exec(text)
    if (!docTitle && hashes.length === 1 && !numbered) {
      docTitle = text
      continue
    }
    if (numbered) {
      const [, number, title] = numbered
      if (!number.includes('.') && Number(number) === expected && hashes.length <= chapterLevel) {
        flushSection()
        current = { number, title, level: 'section', text: [] }
        sections.push(current)
        expected += 1
        chapterLevel = Math.min(chapterLevel, hashes.length)
        continue
      }
      if (number.includes('.') && current && number.startsWith(`${current.number}.`)) {
        flushSub()
        sub = { number, title, level: 'subsection', text: [], depth: hashes.length }
        sections.push(sub)
        current.text.push(line)
        continue
      }
    }
    // 番号なし・番号が連続しない見出しは本文の一部。小節より深い見出し（4.1 の中の「### Equal Earth」）は
    // その小節の本文に含め、同じ深さ以上なら小節を閉じる。
    if (sub && hashes.length > sub.depth) {
      sub.text.push(line)
    } else {
      flushSub()
    }
    if (current) current.text.push(line)
  }
  flushSection()
  return { title: docTitle, sections }
}

// 目次（番号・タイトル・階層）。
export function buildToc(sections) {
  return sections.map((s) => ({ number: s.number, title: s.title, level: s.level }))
}

// 節を探す。番号の完全一致 → タイトルの部分一致（大文字小文字を無視）。
// 戻り値: { section } | { candidates: [...] } | { section: null, candidates: [] }
export function findSection(sections, query) {
  const q = String(query ?? '').trim()
  if (!q) return { section: null, candidates: [] }
  const byNumber = sections.find((s) => s.number === q || s.number === q.replace(/^§/, '').replace(/\.$/, ''))
  if (byNumber) return { section: byNumber, candidates: [] }
  const lower = q.toLowerCase()
  const matches = sections.filter((s) => s.title.toLowerCase().includes(lower))
  if (matches.length === 1) return { section: matches[0], candidates: [] }
  return { section: null, candidates: matches }
}

// 前後の章（読み進める手掛かり）。
export function neighbors(sections, section) {
  const tops = sections.filter((s) => s.level === 'section')
  const parentNumber = section.number.split('.')[0]
  const index = tops.findIndex((s) => s.number === parentNumber)
  const pick = (s) => (s ? { number: s.number, title: s.title } : null)
  return { prev: pick(tops[index - 1]), next: pick(tops[index + 1]) }
}

// 長い本文を切り詰める。
export function clipText(text, maxChars = DEFAULT_MAX_CHARS) {
  const source = String(text ?? '')
  const limit = Math.max(200, Number(maxChars) || DEFAULT_MAX_CHARS)
  if (source.length <= limit) return { text: source, truncated: false }
  return { text: `${source.slice(0, limit)}\n…（以降 ${source.length - limit} 文字を省略。小節番号で絞るか maxChars を増やしてください）`, truncated: true }
}
