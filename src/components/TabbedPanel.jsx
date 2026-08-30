// 汎用タブパネル。
// 流用元: gee-ai-agent/src/components/TabbedPanel.jsx
//
// 役割: サイドバーの「チャット / ログ」などを切り替える土台。
//       表示するタブ構成に依存しない汎用部品にして、タブの増減を容易にする。
// 関係: App がタブ定義（id・label・content）の配列を渡す。
//       非制御（内部 state）と制御（activeId + onTabChange）の両対応。制御モードは
//       「音声の run_prompt でチャットタブを開く」のようにプログラムからタブを切り替える用途。
import { useState } from 'react'

// tabs: [{ id, label, content }]
function TabbedPanel({ tabs, initialId, activeId: controlledId, onTabChange }) {
  const [internalId, setInternalId] = useState(initialId ?? tabs[0]?.id)
  const isControlled = controlledId != null
  const activeId = isControlled ? controlledId : internalId
  const active = tabs.find((t) => t.id === activeId) ?? tabs[0]

  const select = (id) => {
    if (!isControlled) setInternalId(id)
    onTabChange?.(id)
  }

  return (
    <div className="tabbed-panel">
      <div className="tab-bar" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === active?.id}
            className={`tab-button${t.id === active?.id ? ' active' : ''}`}
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-content" role="tabpanel">
        {active?.content}
      </div>
    </div>
  )
}

export default TabbedPanel
