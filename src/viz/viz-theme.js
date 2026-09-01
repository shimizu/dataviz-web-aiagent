// 可視化のデザイントークン（render に theme として渡す）。
//
// 役割: 色・フォント・線幅・余白を生成コードに散らばらせないための単一の定義。決定的な値だけを持つ
//       （スキルの表もここから生成するので、揮発情報を入れない）。
// 配色の方針:
//   - カテゴリ色は **固定順の 8 色**（青・橙・緑青・黄・マゼンタ・緑・紫・赤）。順番を飛ばさず、循環させない。
//     白背景で明度帯・彩度・色覚多様性（隣接ペアの ΔE ≥ 8）・通常視の判別（ΔE ≥ 15）を検証済み。
//     先頭 4 色は「どの 2 色も隣り合いうる」散布図・地図でも合格する。
//   - 「注目以外」のグレーは **見える濃さ**（#8a8983 = 白に対して 3.5:1）。薄い水色や #ccc 系で系列を描かない。
//   - 量は単色ランプ（薄 → 濃）、差は赤 ↔ 青 + 中立グレー、状態（正 / 負）は専用色。虹色は使わない。
//   - 文字は常にインク色（系列色で文字を書かない）。
// 関係: viz-frame-bridge.js が render 要求に同梱し、zip の viz.js にも埋め込む。skills/dataviz-workflow.js が表にする。
// 流用元: 検証済みの汎用パレット（validate_palette.js で白背景を検査）+ reference/*.md のトークンの構造。

// カテゴリ色（固定順）。scaleOrdinal(theme.series) で 1 番目から順に割り当てる。
const SERIES = Object.freeze(['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'])

export const VIZ_THEME = Object.freeze({
  colors: Object.freeze({
    background: '#ffffff',
    text: '#0b0b0b', // タイトル・値・直接ラベル
    secondaryText: '#52514e', // サブタイトル・注釈・凡例の文字
    mutedText: '#898781', // 軸の目盛り文字・出典
    axis: '#c3c2b7', // 軸線・0 の基準線
    grid: '#e1e0d9', // グリッド（極細）
    primary: SERIES[0], // 系列 1 色目 = 基本の青
    accent: SERIES[1], // 強調（橙）。基本色の図の中で 1 つだけ目立たせるとき
    context: '#8a8983', // 注目以外の系列（3.5:1。これより薄くしない）
    positive: '#0ca30c', // 増加・良い
    negative: '#d03b3b', // 減少・悪い
    noData: '#d9d8d2', // データなし（斜線パターンと併用）
  }),
  // カテゴリ色。名前は説明用。
  series: SERIES,
  seriesNames: Object.freeze(['青', '橙', '緑青', '黄', 'マゼンタ', '緑', '紫', '赤']),
  // 量（一方向）の単色ランプ。5 段階の階級用と、連続用の d3 補間。
  sequential: Object.freeze({
    blue5: Object.freeze(['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b']),
    blue7: Object.freeze(['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']),
    interpolators: 'd3.interpolateBlues / d3.interpolateYlGnBu / d3.interpolateYlOrRd / d3.interpolateViridis（多色ランプは Viridis だけ）',
  }),
  // 基準からの差。両極は暖色 ↔ 寒色、中立はグレー。
  diverging: Object.freeze({
    negative: '#d03b3b',
    neutral: '#f0efec',
    positive: '#2a78d6',
    interpolator: 'd3.interpolateRdBu（左が赤 = 負、右が青 = 正。中央は無彩色）',
  }),
  map: Object.freeze({
    ocean: '#eef3f8',
    land: '#f3f2ee',
    graticule: '#e1e0d9',
    borders: Object.freeze({ coast: '#898781', national: '#898781', regional: '#c3c2b7', local: '#e1e0d9' }),
    labels: Object.freeze({ primary: '#0b0b0b', secondary: '#52514e', halo: '#ffffff' }),
    lineWidth: Object.freeze({ coastline: 0.8, national: 0.7, regional: 0.45, local: 0.25 }),
  }),
  // 注釈の慣習（参照線・帯・強調点）。主役のデータより弱く描く。
  annotation: Object.freeze({
    line: '#52514e', // 参照線（平均・目標・イベント）
    dash: '4 4',
    width: 1.2,
    bandFill: '#2a78d6', // 範囲の帯（bandOpacity で薄く敷く）
    bandOpacity: 0.08,
    highlight: '#e34948', // 最大値・異常値など強調する 1 点
    fontSize: 11,
  }),
  // 凡例の寸法（自作するときの既定値）。
  legend: Object.freeze({
    markerSize: 8, // 線・点系列のマーカー径
    rowGap: 8,
    colGap: 12,
    swatch: 14, // 階級・分類の色見本の一辺
    continuousLength: 200, // 連続凡例の帯の長さ
    fontSize: 12,
  }),
  // ラベルの可視性。
  label: Object.freeze({
    haloWidth: 3, // 地図・塗りの上の文字の縁取り幅
    minFontSize: 9, // これ未満の文字は使わない
    insideDark: '#0b0b0b', // 薄い塗りの内側ラベル
    insideLight: '#ffffff', // 濃い塗りの内側ラベル
  }),
  // 英数字 = Roboto Condensed（先に書く）/ 和文 = Noto Sans JP（後ろへフォールバック）。
  // 順序を入れ替えると英数字も Noto の字形になるので厳守。後続はオフライン用のシステム和文。
  // ウェイトの階層（タイトル 700 / 図内数値 800 / ラベル 600）が「デザインされて見える」大部分を担う。
  font: Object.freeze({
    family: '"Roboto Condensed", "Noto Sans JP", system-ui, "Hiragino Sans", "Yu Gothic", sans-serif',
    title: 20,
    subtitle: 13,
    axis: 11,
    label: 12,
    note: 10,
    weights: Object.freeze({ title: 700, subtitle: 400, value: 800, label: 600, axis: 400, source: 500 }),
    letterSpacing: Object.freeze({ title: '-0.02em', source: '0.08em' }),
  }),
  line: Object.freeze({ normal: 2, focus: 2.5, context: 1.5 }),
  radius: Object.freeze({ point: 4, focus: 5.5 }),
  margin: Object.freeze({ top: 56, right: 24, bottom: 44, left: 56 }),
})

// スキル用の表（決定的）。配列は 1 行にまとめる。
export function describeTheme(theme = VIZ_THEME) {
  const rows = []
  const walk = (obj, prefix) => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (Array.isArray(value)) rows.push(`| \`theme.${path}\` | \`[${value.map((v) => `'${v}'`).join(', ')}]\` |`)
      else if (value && typeof value === 'object') walk(value, path)
      else rows.push(`| \`theme.${path}\` | \`${value}\` |`)
    }
  }
  walk(theme, '')
  return ['| キー | 値 |', '|---|---|', ...rows].join('\n')
}
