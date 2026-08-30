// 音声セッション（Gemini Live）へ渡す状況の組み立て（純関数）。
//
// 役割: 接続時の指示文に入れる `buildContext(): string` と、ツール応答へ同梱する `buildSnapshot(): object` の中身を作る。
//       Gemini にはドメインのツールを渡さないので、「今どんなデータがあり、どの図を見ているか」はこの 2 つで伝える
//       （会話中の変化を sendText で割り込ませない）。App は状態を渡すだけ。
// 関係: App.jsx が useVoiceSession の buildContext / buildSnapshot に繋ぐ。戻り値に `claude_running` と衝突するキーを入れない。
import { formatDatasetList } from '../data/dataset-shapes.js'

const APP_INTRO = `## このアプリ
ユーザーが csv / tsv / geojson / geotiff をドロップし、Claude が D3 で図を作るデータ可視化ツールです。
Claude は「データの確認 → 図の提案 → 描画 → 修正」を行い、できた図は画面の「可視化」タブに出て SVG / PNG / ZIP で保存できます。
run_prompt に渡す指示文は「どのデータの何を、どんな図で見たいか」が分かる文にしてください（例: 「ds_001 の売上を都市別の横棒で」）。
図そのものについて聞かれたら look_at_visualization で実際に見てから答えてください。`

const NO_DATASETS = `## 読み込み済みデータセット
まだありません。画面左の「データ」タブに csv / tsv / geojson / geotiff をドロップするよう案内してください。`

// 接続時の system instruction に入れる状況。
export function buildVoiceContextText({ datasets = [], viz = null, version = null } = {}) {
  const parts = [APP_INTRO]
  parts.push(datasets.length > 0 ? formatDatasetList(datasets) : NO_DATASETS)
  if (viz) {
    const description = viz.description ? `（${viz.description}）` : ''
    parts.push(`## 現在の可視化\n${viz.id} v${version?.version ?? '?'}「${viz.title}」${description}`)
  } else {
    parts.push('## 現在の可視化\nまだありません。')
  }
  return parts.join('\n\n')
}

// ツール応答へ同梱する状況。
export function buildVoiceSnapshotData({ datasets = [], viz = null, version = null } = {}) {
  return {
    datasets: datasets.map((d) => ({ id: d.id, name: d.name, kind: d.kind })),
    visualization: viz ? { id: viz.id, title: viz.title, version: version?.version ?? null } : null,
  }
}

// Claude 完了通知に足す補足（読み上げを具体的にする）。
export function buildFinishedExtras({ viz = null, version = null } = {}) {
  if (!viz) return ''
  return `可視化 ${viz.id} v${version?.version ?? '?'}「${viz.title}」を表示中です。`
}
