// イントロダクション（About）モーダル。
//
// 役割: 「何ができるアプリか」と必要な設定を簡潔に提示する。初回アクセス時に自動表示し、
//       ヘッダーの About からいつでも再表示できる。
function AboutModal({ onClose }) {
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
        <h3>🎙 voice-agent-shell</h3>
        <p className="about-lead">
          ブラウザだけで動く「音声 × ツール実行」エージェントの最小シェルです。2 つの LLM を役割分担させています:
          <b>Claude</b> がツールを使って実際の処理を行い、<b>Gemini Live</b> が音声でユーザーと会話して
          Claude への指示文を作り、実行を依頼します。
        </p>
        <ul className="about-list">
          <li>🤖 日本語で指示 → Claude がツール（同梱サンプル: 現在時刻・計算）を呼んで回答</li>
          <li>🎙 マイクで相談 → Gemini が要件を整理して run_prompt で Claude を実行、完了を読み上げ</li>
          <li>🧩 ツールソース（src/tools/*）を足すだけで、ツール登録とシステムプロンプトの両方に反映</li>
          <li>🔒 バックエンド無し。API キーはこのブラウザの localStorage にだけ保存</li>
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
