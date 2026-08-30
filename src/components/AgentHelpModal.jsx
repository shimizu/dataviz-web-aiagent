// エージェントの使い方（サンプルプロンプト）モーダル。
//
// 役割: データ可視化エージェント向けのサンプルプロンプトを提示し、クリックで入力欄へ挿入する。
const SAMPLE_GROUPS = [
  {
    title: 'データを読む',
    prompts: ['読み込んだデータを説明して', 'このデータで何が分かりそう？', '欠損や外れ値はある？'],
  },
  {
    title: '図を作る',
    prompts: ['売上の推移を折れ線で', '都市別の合計を横棒で、上位 10 件だけ', '2 つの列の関係を散布図で', '都道府県ごとの割合をコロプレスで'],
  },
  {
    title: '図を直す',
    prompts: ['注目したい系列だけ青にして他はグレーに', '凡例をやめて線の端に名前を', 'タイトルを「何が分かるか」に変えて', '2024 年以降だけに絞って'],
  },
  {
    title: '分析してから描く',
    prompts: ['月ごとに集計してから推移を描いて', 'CSV と GeoJSON をコードで結合して地図に', '前年比を計算して増減を色分け'],
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
