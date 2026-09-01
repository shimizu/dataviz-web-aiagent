import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { buildToc, clipText, findSection, neighbors, splitSections } from '../src/tools/dataviz/reference-index.js'
import { makeReferenceHandlers } from '../src/tools/dataviz/reference-handlers.js'
import { REFERENCE_TOPICS } from '../src/tools/dataviz/reference-loader.js'
import { DATAVIZ_WORKFLOW_SKILL } from '../src/agent/skills/dataviz-workflow.js'
import { DATAVIZ_CHARTS_SKILL } from '../src/agent/skills/dataviz-charts.js'
import { GEOJSON_REFERENCE_TOC } from '../src/agent/skills/dataviz-geojson.js'
import { MAPS_REFERENCE_TOC } from '../src/agent/skills/dataviz-maps.js'
import { RASTER_REFERENCE_TOC } from '../src/agent/skills/dataviz-raster.js'
import { DATAVIZ_GEOJSON_SKILL } from '../src/agent/skills/dataviz-geojson.js'
import { DATAVIZ_MAPS_SKILL } from '../src/agent/skills/dataviz-maps.js'
import { DATAVIZ_RASTER_SKILL } from '../src/agent/skills/dataviz-raster.js'
import { datavizSource } from '../src/tools/dataviz/index.js'
import { ToolRegistry } from '../src/agent/tool-registry.js'

const readGuide = (topic) => readFileSync(new URL(`../reference/${REFERENCE_TOPICS[topic].file}`, import.meta.url), 'utf8')

const FIXTURE = `# ガイドの題名

前書き。

## 1. はじめに
本文 1。
### 1. 原則その一
原則。
### 2. 原則その二
原則 2（章ではない）。
## 2. 基本
本文 2。
# 3. 応用
本文 3。
## 3.1 小節 A
小節 A の本文。
### 深い見出し
深い見出しの本文（小節 A に含まれる）。
\`\`\`js
## 4. これはコードなので見出しではない
\`\`\`
## 3.2 小節 B
小節 B の本文。
## 推奨描画順
番号なし。
# 4. まとめ
## 1
まとめの 1（章ではない）。
`

test('splitSections は番号の連続性と見出しレベルで章を判定し、小節とコード内の見出しを正しく扱う', () => {
  const { title, sections } = splitSections(FIXTURE)
  assert.equal(title, 'ガイドの題名')
  const chapters = sections.filter((s) => s.level === 'section')
  assert.deepEqual(chapters.map((s) => `${s.number} ${s.title}`), ['1 はじめに', '2 基本', '3 応用', '4 まとめ'])
  const subs = sections.filter((s) => s.level === 'subsection')
  assert.deepEqual(subs.map((s) => s.number), ['3.1', '3.2'])
  assert.match(chapters[0].text, /原則その二/, '章の本文には小見出しも含む')
  assert.match(subs[0].text, /小節 A の本文/)
  assert.match(subs[0].text, /深い見出しの本文/, '小節より深い見出しは小節に含める')
  assert.match(subs[0].text, /## 4\. これはコードなので見出しではない/, 'コードフェンス内は見出し扱いしない')
  assert.doesNotMatch(subs[0].text, /小節 B/)
  assert.match(chapters[3].text, /まとめの 1/)
})

test('findSection / neighbors / clipText / buildToc', () => {
  const { sections } = splitSections(FIXTURE)
  assert.equal(findSection(sections, '3.1').section.title, '小節 A')
  assert.equal(findSection(sections, '§3').section.title, '応用')
  assert.equal(findSection(sections, '3.').section.title, '応用')
  assert.equal(findSection(sections, '小節 b').section.title, '小節 B', '部分一致・大文字小文字無視')
  const multi = findSection(sections, '小節')
  assert.equal(multi.section, null)
  assert.equal(multi.candidates.length, 2)
  assert.deepEqual(findSection(sections, ''), { section: null, candidates: [] })
  assert.deepEqual(neighbors(sections, findSection(sections, '3.1').section), { prev: { number: '2', title: '基本' }, next: { number: '4', title: 'まとめ' } })
  assert.equal(neighbors(sections, sections[0]).prev, null)
  assert.deepEqual(buildToc(sections)[0], { number: '1', title: 'はじめに', level: 'section' })
  const clipped = clipText('x'.repeat(500), 200)
  assert.equal(clipped.truncated, true)
  assert.match(clipped.text, /以降 300 文字を省略/)
  assert.equal(clipText('short', 200).truncated, false)
})

test('実ファイルの 4 本を章に分割できる', () => {
  const expected = { dataviz: 22, maps: 31, geojson: 21, raster: 69 }
  for (const [topic, count] of Object.entries(expected)) {
    const { title, sections } = splitSections(readGuide(topic))
    const chapters = sections.filter((s) => s.level === 'section')
    assert.equal(chapters.length, count, `${topic} の章数`)
    assert.ok(title.length > 0, `${topic} の題名`)
    // 章番号は 1 から連番
    assert.deepEqual(chapters.map((s) => Number(s.number)), chapters.map((_, i) => i + 1))
  }
  const dataviz = splitSections(readGuide('dataviz')).sections
  assert.equal(findSection(dataviz, '6.3').section.title, 'grid line は薄く')
  assert.match(findSection(dataviz, '1').section.text, /12原則|原則/)
  const maps = splitSections(readGuide('maps')).sections
  assert.equal(findSection(maps, '4.1').section.title, '世界全体')
  assert.match(findSection(maps, '4.1').section.text, /### Equal Earth[\s\S]*geoEqualEarth/, '小節より深い見出しは小節の本文に含める')
  assert.doesNotMatch(findSection(maps, '4.1').section.text, /大陸・中緯度地域/, '次の小節 4.2 は含めない')
  assert.match(findSection(maps, '1').section.text, /Mercatorを惰性で使わない/, '15 原則の見出しは §1 の本文に含まれる')
})

test('スキルの目次はガイドの章番号・見出しと一致する', () => {
  const pairs = [
    ['maps', MAPS_REFERENCE_TOC, DATAVIZ_MAPS_SKILL],
    ['geojson', GEOJSON_REFERENCE_TOC, DATAVIZ_GEOJSON_SKILL],
    ['raster', RASTER_REFERENCE_TOC, DATAVIZ_RASTER_SKILL],
  ]
  for (const [topic, toc, skill] of pairs) {
    const { sections } = splitSections(readGuide(topic))
    for (const [number, title] of toc) {
      const found = findSection(sections, number).section
      assert.ok(found, `${topic} §${number} がガイドに無い`)
      assert.equal(found.title, title, `${topic} §${number} の見出し`)
      assert.ok(skill.includes(`| ${number} | ${title} |`), `${topic} のスキルに §${number} の行が無い`)
    }
    assert.match(skill, new RegExp(`read_reference\\('${topic}'`))
    assert.ok(!skill.includes(new Date().toISOString().slice(0, 10)), '揮発情報を含めない')
  }
})

test('read_reference は目次・本文・候補・エラーを返す', async () => {
  const loads = []
  const handlers = makeReferenceHandlers({
    loadGuide: async (topic) => {
      loads.push(topic)
      return FIXTURE
    },
  })
  const toc = await handlers.readReference({ topic: 'maps' })
  assert.equal(toc.title, 'ガイドの題名')
  assert.equal(toc.sections.length, 6)
  assert.match(toc.about, /地図/)

  const body = await handlers.readReference({ topic: 'maps', section: '3.1' })
  assert.equal(body.number, '3.1')
  assert.equal(body.heading, '小節 A')
  assert.match(body.text, /小節 A の本文/)
  assert.equal(body.truncated, false)
  assert.deepEqual(body.next, { number: '4', title: 'まとめ' })

  const clipped = await handlers.readReference({ topic: 'maps', section: '1', maxChars: 200 })
  assert.equal(clipped.truncated, false, '短い本文は切らない')

  const multi = await handlers.readReference({ topic: 'maps', section: '小節' })
  assert.equal(multi.candidates.length, 2)
  await assert.rejects(handlers.readReference({ topic: 'maps', section: '存在しない' }), /節が見つかりません/)
  await assert.rejects(handlers.readReference({ topic: 'nope' }), /topic が不正/)
  assert.deepEqual(loads, ['maps'], '同じ topic は 1 度しか読み込まない')
})

test('dataviz ソースは read_reference を登録し、スキルを 5 本持つ', () => {
  const registry = new ToolRegistry()
  datavizSource.register(registry, { loadGuide: async () => FIXTURE })
  assert.ok(registry.definitions().map((d) => d.name).includes('read_reference'))
  assert.equal(datavizSource.skills.length, 5)
  assert.deepEqual(
    datavizSource.skills.map((s) => s.split('\n')[0]),
    ['# スキル: データ可視化の進め方', '# スキル: チャートの作法（折れ線・棒・散布図・分布）', '# スキル: 地図の作法（コロプレス・比例シンボル・ラベル）', '# スキル: GeoJSON の診断と修正', '# スキル: ラスタ（GeoTIFF）の作法'],
  )
  const total = datavizSource.skills.reduce((n, s) => n + s.length, 0)
  assert.ok(total < 55_000, `スキル合計 ${total} 文字（目安 5.5 万文字以内。cache_control 前提でも注意の希釈を防ぐため増やしすぎない）`)
})

test('全スキルが MUST を持ち、作図系スキルは事故集を持つ', () => {
  for (const skill of datavizSource.skills) {
    assert.ok(skill.includes('守る規則（MUST）'), `${skill.split('\n')[0]} に MUST が無い`)
  }
  for (const skill of [DATAVIZ_CHARTS_SKILL, DATAVIZ_MAPS_SKILL, DATAVIZ_GEOJSON_SKILL, DATAVIZ_RASTER_SKILL]) {
    assert.ok(skill.includes('よくある事故と修正'), `${skill.split('\n')[0]} に事故集が無い`)
  }
})

test('workflow の意図表・スキル本文の read_reference は実在する節番号を指す', () => {
  const cache = new Map()
  const sectionsOf = (topic) => {
    if (!cache.has(topic)) cache.set(topic, splitSections(readGuide(topic)).sections)
    return cache.get(topic)
  }
  const skills = [DATAVIZ_WORKFLOW_SKILL, DATAVIZ_CHARTS_SKILL, DATAVIZ_MAPS_SKILL, DATAVIZ_GEOJSON_SKILL, DATAVIZ_RASTER_SKILL]
  let checked = 0
  for (const skill of skills) {
    for (const m of skill.matchAll(/read_reference\('(\w+)', '(\d+(?:\.\d+)?)'\)/g)) {
      const [, topic, number] = m
      assert.ok(findSection(sectionsOf(topic), number).section, `${topic} §${number} がガイドに無い`)
      checked += 1
    }
  }
  assert.ok(checked >= 14, `意図表の参照が少なすぎる（${checked} 件）`)
})
