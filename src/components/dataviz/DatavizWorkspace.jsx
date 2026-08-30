// 主画面（.workspace-main の中身）。
//
// 役割: 「データ」（取り込みと確認）と「可視化」（描画結果。M3 で中身を入れる）をタブで切り替える。
//       表示と入力だけを担い、取り込み・描画は App から渡されたハンドラに任せる。
// 関係: App.jsx が配置。既存の TabbedPanel を再利用する。
import { useState } from 'react'

import TabbedPanel from '../TabbedPanel'
import DropZone from './DropZone'
import DatasetList from './DatasetList'
import DatasetPreview from './DatasetPreview'

function DatavizWorkspace({ datasets, hydrated, busy, errors, onFiles, onRemoveDataset, vizSlot }) {
  const [selectedId, setSelectedId] = useState(null)
  const selected = datasets.find((d) => d.id === selectedId) ?? datasets[datasets.length - 1] ?? null

  const dataTab = (
    <div className="data-panel">
      <DropZone onFiles={onFiles} busy={busy} />
      {errors.length > 0 && (
        <ul className="import-errors">
          {errors.map((e) => (
            <li key={`${e.name}:${e.message}`}>
              <strong>{e.name}</strong>: {e.message}
            </li>
          ))}
        </ul>
      )}
      {!hydrated && <p className="empty-state">保存済みデータを読み込んでいます…</p>}
      <DatasetList datasets={datasets} selectedId={selected?.id ?? null} onSelect={setSelectedId} onRemove={onRemoveDataset} />
      <DatasetPreview dataset={selected} />
    </div>
  )

  const tabs = [
    { id: 'data', label: `データ${datasets.length > 0 ? `（${datasets.length}）` : ''}`, content: dataTab },
    { id: 'viz', label: '可視化', content: vizSlot ?? <p className="empty-state">まだ可視化はありません。チャットで作りたい図を伝えてください。</p> },
  ]

  return <TabbedPanel tabs={tabs} initialId="data" />
}

export default DatavizWorkspace
