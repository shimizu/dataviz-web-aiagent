// 可視化タブ（表示と入力のみ）。
//
// 役割: 可視化フレーム（bridge の iframe 要素）を DOM に載せ、可視化の一覧・バージョン切替・ダウンロードボタンを出す。
//       描画・書き出しの処理は App から渡されたハンドラに任せる。
// 関係: DatavizWorkspace が配置。frameElement は viz-frame-bridge の element（App が 1 つだけ作る）。
//       **iframe は DOM から外すと再読み込みになる**ので、このコンポーネントは常にマウントしたままにする
//       （タブが非表示のときは親が画面外へ動かす）。
import { useEffect, useRef } from 'react'

function VizPanel({ frameElement, visualizations, current, onSelect, onSelectVersion, onDownload, downloading, frameReady }) {
  const hostRef = useRef(null)

  // iframe を 1 度だけ載せる（React の管理外の要素なので ref で追加する）。
  useEffect(() => {
    const host = hostRef.current
    if (!host || !frameElement) return undefined
    if (frameElement.parentNode !== host) host.appendChild(frameElement)
    return undefined
  }, [frameElement])

  const viz = current ? visualizations.find((v) => v.id === current.vizId) ?? null : null
  const version = viz ? viz.versions.find((v) => v.version === (current.version ?? viz.currentVersion)) ?? viz.versions.at(-1) : null

  return (
    <div className="viz-panel">
      <div className="viz-toolbar">
        <select
          className="viz-select"
          value={viz?.id ?? ''}
          onChange={(e) => onSelect?.(e.target.value)}
          disabled={visualizations.length === 0}
          aria-label="可視化を選ぶ"
        >
          {visualizations.length === 0 && <option value="">（まだ可視化はありません）</option>}
          {visualizations.map((v) => (
            <option key={v.id} value={v.id}>
              {v.id}: {v.title}
            </option>
          ))}
        </select>
        {viz && viz.versions.length > 1 && (
          <select className="viz-select viz-select-version" value={version?.version ?? ''} onChange={(e) => onSelectVersion?.(viz.id, Number(e.target.value))} aria-label="バージョン">
            {viz.versions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version}
                {v.changeNote ? `: ${v.changeNote}` : ''}
              </option>
            ))}
          </select>
        )}
        {version && (
          <span className="viz-meta">
            {version.width}×{version.height}
            {version.warnings?.length ? `・警告 ${version.warnings.length}` : ''}
          </span>
        )}
        <span className="header-spacer" />
        {['svg', 'png', 'zip'].map((kind) => (
          <button key={kind} type="button" className="ghost-button" disabled={!viz || downloading} onClick={() => onDownload?.(kind)}>
            {kind.toUpperCase()}
          </button>
        ))}
      </div>
      {viz?.description && <p className="viz-description">{viz.description}</p>}
      {version?.warnings?.length > 0 && (
        <ul className="viz-warnings">
          {version.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <div className="viz-frame-host" ref={hostRef}>
        {!frameReady && <p className="empty-state viz-frame-status">可視化フレームを起動しています…</p>}
        {frameReady && !viz && <p className="empty-state viz-frame-status">チャットで作りたい図を伝えると、ここに表示されます。</p>}
      </div>
    </div>
  )
}

export default VizPanel
