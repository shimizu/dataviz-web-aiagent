// イントロダクション（About）モーダル。
//
// 役割: 「何ができるアプリか」と必要な設定を簡潔に提示する。初回アクセス時に自動表示し、
//       ヘッダーの About からいつでも再表示できる。
function AboutModal({ onClose }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
        <h3>📊 データ可視化エージェント</h3>
        <p className="about-lead">
          csv / tsv / geojson / geotiff をドロップし、チャットか音声で相談しながら、<b>Claude</b> が D3 で図を作ります。
          データの確認 → 提案と質問 → 描画 → 修正、を対話で進め、できた図は SVG / PNG / ZIP（html + js + css + データ）で保存できます。
        </p>
        <ul className="about-list">
          <li>📁 左の「データ」タブにファイルをドロップ（複数可）。列の型や地物の診断をその場で確認</li>
          <li>💬 「売上の推移を折れ線で」と頼むと、Claude がデータを読んで図を描き、「可視化」タブに表示</li>
          <li>🎙 マイクで相談 → Gemini が要件を整理して Claude に依頼、完了を読み上げ（任意）</li>
          <li>💾 SVG / PNG / ZIP でダウンロード。ZIP はブラウザで開けば同じ図が動く</li>
          <li>🔒 バックエンド無し。データと API キーはこのブラウザの中にだけ保存（「新しい会話」で全消去）</li>
        </ul>
        <p className="about-start">
          必要な設定（ヘッダー右の ⚙）: Claude API キー（必須）。音声で相談するには Gemini API キー（任意）も入れてください。
        </p>
        <div className="modal-actions">
          <button className="primary" onClick={onClose}>
            はじめる
          </button>
        </div>
      </div>
    </div>
  )
}

export default AboutModal
