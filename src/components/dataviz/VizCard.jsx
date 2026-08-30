// チャットに出す可視化カード（表示のみ）。
//
// 役割: postChatMessage({ kind: 'viz', vizId, version, title }) をサムネイル付きで描く。
//       生成 SVG を親 DOM に inline 展開せず、data: URL の <img> として表示する（XSS 回避）。
// 関係: App.jsx の renderMessage が使う。SVG は visualization-store から props で受ける。
function svgToDataUrl(svg) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function VizCard({ vizId, version, title, svg, missing, onShow }) {
  return (
    <div className="viz-card">
      <div className="viz-card-head">
        <strong>{title ?? vizId}</strong>
        <span className="viz-card-meta">
          {vizId} v{version}
        </span>
      </div>
      {svg ? (
        <button type="button" className="viz-card-thumb" onClick={() => onShow?.(vizId, version)} title="可視化タブで表示">
          <img src={svgToDataUrl(svg)} alt={title ?? vizId} />
        </button>
      ) : (
        <p className="viz-card-missing">{missing ?? 'この可視化は削除されています。'}</p>
      )}
      {svg && (
        <button type="button" className="link-btn" onClick={() => onShow?.(vizId, version)}>
          可視化タブで表示
        </button>
      )}
    </div>
  )
}

export default VizCard
