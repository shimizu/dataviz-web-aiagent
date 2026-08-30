// 主画面（.workspace-main の中身）。
//
// 役割: 「データ」（取り込みと確認）と「可視化」（描画結果）をタブで切り替える。表示と入力だけを担い、
//       取り込み・描画・書き出しは App から渡されたハンドラに任せる。
//       可視化タブには iframe（可視化フレーム）が居るので、**両方のパネルを常にマウント**し、
//       非表示側は CSS で画面外へ動かす（TabbedPanel は非アクティブの内容を外すので使わない。
//       display:none だと iframe 内のレイアウト値が取れなくなるので visibility + 画面外で隠す）。
// 関係: App.jsx が配置し、activeTab / onTabChange で制御する。
import { useState } from 'react'

import DropZone from './DropZone'
import DatasetList from './DatasetList'
import DatasetPreview from './DatasetPreview'
import VizPanel from './VizPanel'

const TABS = [
  { id: 'data', label: 'データ' },
  { id: 'viz', label: '可視化' },
]

function DatavizWorkspace({
  activeTab = 'data',
  onTabChange,
  datasets,
  hydrated,
  busy,
  errors,
  onFiles,
  onRemoveDataset,
  visualizations,
  currentViz,
  frameElement,
  frameReady,
  downloading,
  onSelectViz,
  onSelectVizVersion,
  onDownload,
}) {
  const [selectedId, setSelectedId] = useState(null)
  const selected = datasets.find((d) => d.id === selectedId) ?? datasets[datasets.length - 1] ?? null

  return (
    <div className="tabbed-panel dataviz-workspace">
      <div className="tab-bar" role="tablist">
        {TABS.map((t) => {
          const count = t.id === 'data' ? datasets.length : visualizations.length
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === activeTab}
              className={`tab-button${t.id === activeTab ? ' active' : ''}`}
              onClick={() => onTabChange?.(t.id)}
            >
              {t.label}
              {count > 0 ? `（${count}）` : ''}
            </button>
          )
        })}
      </div>
      <div className={`tab-content workspace-pane${activeTab === 'data' ? '' : ' pane-hidden'}`} role="tabpanel" hidden={activeTab !== 'data'}>
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
      </div>
      {/* 可視化パネルは iframe を保持するため hidden にせず、画面外へ退避する */}
      <div className={`tab-content workspace-pane${activeTab === 'viz' ? '' : ' pane-offscreen'}`} role="tabpanel" aria-hidden={activeTab !== 'viz'}>
        <VizPanel
          frameElement={frameElement}
          frameReady={frameReady}
          visualizations={visualizations}
          current={currentViz}
          downloading={downloading}
          onSelect={onSelectViz}
          onSelectVersion={onSelectVizVersion}
          onDownload={onDownload}
        />
      </div>
    </div>
  )
}

export default DatavizWorkspace
