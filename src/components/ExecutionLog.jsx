// 実行ログパネル。
// 流用元: gee-ai-agent/src/components/ExecutionLog.jsx
//
// 役割: エージェントのツール実行・エラー自己修正・音声セッションの経過を時系列で表示する。
// 関係: logs は App が保持する [{ id, message }] 配列。新しいものを末尾に積む。
function ExecutionLog({ logs }) {
  if (!logs || logs.length === 0) {
    return <p className="empty-state">操作ログはまだありません。</p>
  }
  return (
    <ul className="execution-log">
      {logs.map((entry) => (
        <li key={entry.id}>{entry.message}</li>
      ))}
    </ul>
  )
}

export default ExecutionLog
