// 選択中データセットの簡易プレビュー（表示のみ）。
//
// 役割: 表なら先頭数十行、GeoJSON なら件数・型・bbox・診断、ラスタならサイズと各バンドの統計を出す。
//       全行は描画せず先頭だけ（20 万行を DOM に流さない）。
// 関係: DatavizWorkspace が配置。値は props のデータセット（dataset-store の保存形）。
const PREVIEW_ROWS = 50

function TabularPreview({ dataset }) {
  const columns = dataset.columns ?? []
  const rows = (dataset.records ?? []).slice(0, PREVIEW_ROWS)
  return (
    <>
      <div className="preview-stats">
        {columns.map((c) => (
          <span key={c.name} className="preview-chip" title={`型: ${c.type}／欠損: ${c.nullCount}`}>
            {c.name}
            <em>{c.type}</em>
          </span>
        ))}
      </div>
      <div className="preview-table-wrap">
        <table className="preview-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.name}>{c.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              // 並び替えも増減もしない読み取り専用のプレビューなので行番号をキーにしてよい。
              // eslint-disable-next-line @eslint-react/no-array-index-key
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.name}>{row[c.name] == null ? <span className="preview-null">—</span> : String(row[c.name])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dataset.rowCount > rows.length && <p className="preview-note">先頭 {rows.length} 行を表示（全 {dataset.rowCount.toLocaleString('ja-JP')} 行）</p>}
    </>
  )
}

function GeoJsonPreview({ dataset }) {
  const properties = dataset.propertiesSchema ?? []
  const bbox = dataset.bbox ? dataset.bbox.map((v) => Number(v).toFixed(3)).join(', ') : '不明'
  return (
    <>
      <dl className="preview-facts">
        <dt>地物数</dt>
        <dd>{dataset.featureCount.toLocaleString('ja-JP')}</dd>
        <dt>種別</dt>
        <dd>{(dataset.geometryTypes ?? []).join(' / ')}</dd>
        <dt>頂点数</dt>
        <dd>{dataset.vertexCount?.toLocaleString('ja-JP') ?? '—'}</dd>
        <dt>bbox</dt>
        <dd>{bbox}</dd>
      </dl>
      <div className="preview-stats">
        {properties.map((c) => (
          <span key={c.name} className="preview-chip">
            {c.name}
            <em>{c.type}</em>
          </span>
        ))}
      </div>
    </>
  )
}

function RasterPreview({ dataset }) {
  return (
    <dl className="preview-facts">
      <dt>サイズ</dt>
      <dd>
        {dataset.width}×{dataset.height}
        {dataset.width !== dataset.originalWidth ? `（原寸 ${dataset.originalWidth}×${dataset.originalHeight} から間引き）` : ''}
      </dd>
      <dt>CRS</dt>
      <dd>{dataset.crs}</dd>
      <dt>nodata</dt>
      <dd>{dataset.nodata ?? '—'}</dd>
      <dt>バンド</dt>
      <dd>
        {(dataset.stats ?? []).map((s, i) => (
          // バンドは番号そのものが識別子。
          // eslint-disable-next-line @eslint-react/no-array-index-key
          <span key={i} className="preview-chip">
            {i}
            <em>
              {s.min == null ? '全て無効' : `${Number(s.min).toPrecision(4)} 〜 ${Number(s.max).toPrecision(4)}`}
            </em>
          </span>
        ))}
      </dd>
    </dl>
  )
}

function DatasetPreview({ dataset }) {
  if (!dataset) return <p className="empty-state">データセットを選ぶと中身を表示します。</p>
  return (
    <section className="dataset-preview">
      <h3>
        {dataset.name} <span className="preview-id">{dataset.id}</span>
      </h3>
      {(dataset.diagnostics ?? []).length > 0 && (
        <ul className="preview-diagnostics">
          {dataset.diagnostics.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
      {dataset.kind === 'tabular' && <TabularPreview dataset={dataset} />}
      {dataset.kind === 'geojson' && <GeoJsonPreview dataset={dataset} />}
      {dataset.kind === 'raster' && <RasterPreview dataset={dataset} />}
    </section>
  )
}

export default DatasetPreview
