// 可視化のデザイントークン（render に theme として渡す）。
//
// 役割: 色・フォント・線幅・余白をコードに散らばらせないための単一の定義。決定的な値だけを持つ
//       （スキルの表もここから生成するので、揮発情報を入れない）。
// 関係: viz-frame-bridge.js が render 要求に同梱し、zip の viz.js にも埋め込む。
// 流用元: reference/d3js_beautiful_dataviz_guide.md §18 と reference/d3js_beautiful_maps_guide.md §28 を統合。
export const VIZ_THEME = Object.freeze({
  colors: Object.freeze({
    background: '#ffffff',
    text: '#111827',
    mutedText: '#6b7280',
    axis: '#9ca3af',
    grid: '#e5e7eb',
    primary: '#2563eb',
    secondary: '#7c3aed',
    muted: '#cbd5e1',
    positive: '#15803d',
    negative: '#b91c1c',
    noData: '#e5e7eb',
    highlight: '#2563eb',
  }),
  map: Object.freeze({
    ocean: '#f8fafc',
    land: '#f1f5f9',
    graticule: '#e2e8f0',
    borders: Object.freeze({ national: '#94a3b8', regional: '#cbd5e1', local: '#e2e8f0' }),
    labels: Object.freeze({ primary: '#334155', secondary: '#64748b', halo: '#ffffff' }),
    lineWidth: Object.freeze({ coastline: 0.8, national: 0.7, regional: 0.45, local: 0.25 }),
  }),
  font: Object.freeze({
    family: '"Noto Sans JP", "Hiragino Sans", "Yu Gothic", system-ui, sans-serif',
    title: 20,
    subtitle: 13,
    axis: 11,
    label: 12,
    note: 10,
  }),
  line: Object.freeze({ normal: 1.5, focus: 2.5 }),
  radius: Object.freeze({ point: 3.5, focus: 5 }),
  margin: Object.freeze({ top: 48, right: 24, bottom: 44, left: 56 }),
})

// スキル用の表（決定的）。
export function describeTheme(theme = VIZ_THEME) {
  const rows = []
  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (value && typeof value === 'object') walk(value, path)
      else rows.push(`| \`theme.${path}\` | \`${value}\` |`)
    }
  }
  walk(theme, '')
  return ['| キー | 値 |', '|---|---|', ...rows].join('\n')
}
