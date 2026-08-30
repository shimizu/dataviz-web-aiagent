// エージェントの使い方（サンプルプロンプト）モーダル。
//
// 役割: 同梱ツールに対応したサンプルプロンプトを提示し、クリックで入力欄へ挿入する。
//       ドメインを足したら SAMPLE_GROUPS を差し替える。
const SAMPLE_GROUPS = [
  {
    title: '時刻',
    prompts: ['今の日時を教えて', 'ニューヨークとロンドンは今何時？', '今日は何曜日？'],
  },
  {
    title: '計算',
    prompts: ['(12.5 + 3) × 4 を計算して', '2 の 10 乗は？', '1 年は何秒？', '消費税 10% 込みで 3,980 円の税抜き価格は？'],
  },
  {
    title: '音声で相談',
    prompts: ['（入力欄横の 🎙 を押して話しかけると、Gemini が指示文を作って Claude に実行を依頼します）'],
  },
]

function AgentHelpModal({ onClose, onPick }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal modal-wide help-modal" onClick={(e) => e.stopPropagation()}>
        <h3>使い方 — サンプルプロンプト</h3>
        <p className="help-lead">クリックすると入力欄に挿入されます（自由に書き換えてください）。</p>
        <div className="help-groups">
          {SAMPLE_GROUPS.map((group) => (
            <section className="help-group" key={group.title}>
              <h4>{group.title}</h4>
              <ul className="help-prompt-list">
                {group.prompts.map((prompt) => (
                  <li key={prompt}>
                    <button type="button" className="help-prompt" onClick={() => onPick(prompt)}>
                      {prompt}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={onClose}>閉じる</button>
        </div>
      </div>
    </div>
  )
}

export default AgentHelpModal
