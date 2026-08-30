// 読み込み済みデータセットの一覧（表示と入力のみ）。
//
// 役割: ID・名前・種別・件数を並べ、選択と削除を親へ通知する。
// 関係: DatavizWorkspace が配置。データは props（App → useStoreItems）。
const KIND_LABEL = { tabular: '表', geojson: '地物', raster: 'ラスタ' }

function describeSize(ds) {
  if (ds.kind === 'tabular') return `${ds.rowCount.toLocaleString('ja-JP')} 行 × ${ds.columns?.length ?? 0} 列`
  if (ds.kind === 'geojson') return `${ds.featureCount.toLocaleString('ja-JP')} 地物・${(ds.geometryTypes ?? []).join('/')}`
  return `${ds.width}×${ds.height}・${ds.bandCount} バンド`
}

function DatasetList({ datasets, selectedId, onSelect, onRemove }) {
  if (datasets.length === 0) return null
  return (
    <ul className="dataset-list">
      {datasets.map((ds) => (
        <li key={ds.id} className={`dataset-item${ds.id === selectedId ? ' selected' : ''}`}>
          <button type="button" className="dataset-item-main" onClick={() => onSelect?.(ds.id)}>
            <span className={`dataset-kind kind-${ds.kind}`}>{KIND_LABEL[ds.kind] ?? ds.kind}</span>
            <span className="dataset-name" title={ds.name}>
              {ds.name}
            </span>
            <span className="dataset-meta">
              {ds.id}・{describeSize(ds)}
              {ds.derivedFrom ? '・分析結果' : ''}
            </span>
          </button>
          <button type="button" className="icon-btn danger" title="削除" aria-label={`${ds.name} を削除`} onClick={() => onRemove?.(ds.id)}>
            ×
          </button>
        </li>
      ))}
    </ul>
  )
}

export default DatasetList
