// read_reference ツールの実装。
//
// 役割: スキルに載せた要約では足りないとき、ガイド（reference/*.md）の目次か特定の節を Claude に返す。
//       本文は 1 度パースしてキャッシュし、tool_result の打ち切り（8000 文字）より手前で自分で切り詰める。
// 関係: index.js が deps を渡して作る。loadGuide はテストの注入点（既定は reference-loader.js の ?raw import）。
import { REFERENCE_TOPICS, loadGuide as defaultLoadGuide } from './reference-loader.js'
import { DEFAULT_MAX_CHARS, buildToc, clipText, findSection, neighbors, splitSections } from './reference-index.js'

export function makeReferenceHandlers({ loadGuide = defaultLoadGuide, log } = {}) {
  const cache = new Map() // topic → { title, sections }

  const getGuide = async (topic) => {
    const key = String(topic ?? '').trim()
    if (!REFERENCE_TOPICS[key]) {
      throw new Error(`topic が不正です: ${key || '(空)'}（${Object.keys(REFERENCE_TOPICS).join(' / ')} のいずれか）`)
    }
    if (!cache.has(key)) cache.set(key, splitSections(await loadGuide(key)))
    return { key, ...cache.get(key) }
  }

  return {
    async readReference({ topic, section, maxChars = DEFAULT_MAX_CHARS } = {}) {
      const guide = await getGuide(topic)
      const query = String(section ?? '').trim()
      if (!query) {
        log?.(`リファレンス目次: ${guide.key}`)
        return {
          topic: guide.key,
          title: guide.title,
          about: REFERENCE_TOPICS[guide.key].label,
          sections: buildToc(guide.sections),
          note: 'section に番号（例: "6.3"）か見出しの一部を指定すると本文が返ります',
        }
      }
      const found = findSection(guide.sections, query)
      if (!found.section) {
        if (found.candidates.length > 0) {
          return {
            topic: guide.key,
            query,
            candidates: found.candidates.map((s) => ({ number: s.number, title: s.title })),
            note: '複数の節が該当します。番号で指定し直してください',
          }
        }
        throw new Error(`節が見つかりません: ${query}（section を省略して目次を確認してください）`)
      }
      const { text, truncated } = clipText(found.section.text, maxChars)
      log?.(`リファレンス参照: ${guide.key} §${found.section.number} ${found.section.title}`)
      return {
        topic: guide.key,
        number: found.section.number,
        heading: found.section.title,
        text,
        truncated,
        ...neighbors(guide.sections, found.section),
      }
    },
  }
}
