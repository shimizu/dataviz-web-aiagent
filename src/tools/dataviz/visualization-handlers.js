// 描画系ツールの実装（render / update）。
//
// 役割: 生成コードを実行前検査 → 必要なデータセットを可視化フレームへ送信 → 描画 → 保存 → チャットへカード投稿、
//       の順で処理し、**要約だけ**を返す（SVG 全文は返さない）。失敗はそのまま例外にして runtime に
//       is_error で返させ、error メッセージ + console + stack でモデルに直させる。
// 関係: index.js が deps を渡して作る。deps = { datasetStore, visualizationStore, vizBridge, postChatMessage,
//       onVisualizationShown, log }。フレーム側の契約は public/viz-frame.js。
import { inspectCode } from '../../analysis/code-guard.js'
import { DEFAULT_VIZ_HEIGHT, DEFAULT_VIZ_WIDTH, clampVizSize } from '../../viz/frame-protocol.js'
import { VIZ_THEME } from '../../viz/viz-theme.js'

// LLM へ返す console の件数（打ち切り対策）。
export const LLM_CONSOLE_LINES = 10

// フレームの失敗結果を、直し方が分かる 1 つのメッセージにまとめる（純関数・テスト対象）。
export function formatRenderFailure(result) {
  const parts = [`描画に失敗しました: ${result?.error?.message ?? '不明なエラー'}`]
  const stack = result?.error?.stack
  if (stack) parts.push(`--- スタック ---\n${String(stack).split('\n').slice(0, 3).join('\n')}`)
  const logs = (result?.console ?? []).slice(-LLM_CONSOLE_LINES)
  if (logs.length > 0) parts.push(`--- console ---\n${logs.map((c) => `[${c.level}] ${c.text}`).join('\n')}`)
  return parts.join('\n')
}

// 成功結果 → LLM へ返す要約（純関数・テスト対象）。
export function summarizeRender({ vizId, version, title, result }) {
  return {
    vizId,
    version,
    title,
    ok: true,
    stats: result.stats ?? {},
    warnings: result.warnings ?? [],
    console: (result.console ?? []).slice(-LLM_CONSOLE_LINES).map((c) => `[${c.level}] ${c.text}`),
    note: '「可視化」タブに表示しました。SVG / PNG / ZIP のダウンロードボタンも同じタブにあります',
  }
}

export function makeVisualizationHandlers({
  datasetStore,
  visualizationStore,
  vizBridge,
  postChatMessage,
  onVisualizationShown,
  log,
  theme = VIZ_THEME,
} = {}) {
  const requireBridge = () => {
    if (!vizBridge) throw new Error('可視化フレームが利用できません（画面を再読み込みしてください）')
    return vizBridge
  }

  // datasetIds を解決してフレームへ送る。
  const sendDatasets = async (ids) => {
    if (!datasetStore) throw new Error('データセットストアが利用できません')
    const unique = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))]
    if (unique.length === 0) throw new Error('datasetIds が空です。list_datasets で ID を確認して指定してください')
    for (const id of unique) {
      const runtime = datasetStore.getRuntime(id)
      if (!runtime) {
        const known = datasetStore.getSnapshot().map((d) => d.id)
        throw new Error(`データセットが見つかりません: ${id}（利用できるのは ${known.join(', ') || 'なし'}）`)
      }
      await vizBridge.putDataset(runtime)
    }
    return unique
  }

  // 共通の描画処理。
  const draw = async ({ code, datasetIds, width, height }) => {
    const source = String(code ?? '')
    if (!source.trim()) throw new Error('code が空です（function render({ container, d3, ... }) を定義するコードを渡してください）')
    const inspection = inspectCode(source)
    if (!inspection.ok) {
      throw new Error(`使用できない参照が含まれています: ${inspection.reasons.join(', ')}。データは datasets から受け取り、外部通信は行わないでください`)
    }
    requireBridge()
    const ids = await sendDatasets(datasetIds ?? [])
    const result = await vizBridge.render({
      code: source,
      datasetIds: ids,
      width: clampVizSize(width, DEFAULT_VIZ_WIDTH),
      height: clampVizSize(height, DEFAULT_VIZ_HEIGHT),
      theme,
    })
    if (!result.ok) throw new Error(formatRenderFailure(result))
    return { result, ids }
  }

  const announce = (viz, version, result) => {
    postChatMessage?.({ kind: 'viz', vizId: viz.id, version, title: viz.title, label: '可視化' })
    onVisualizationShown?.(viz.id)
    log?.(`🖼 ${viz.id} v${version}「${viz.title}」を描画（${result.stats?.elementCount ?? '?'} 要素・${result.stats?.durationMs ?? '?'}ms）`)
  }

  return {
    async renderVisualization({ title, code, datasetIds, width, height, description } = {}) {
      const label = String(title ?? '').trim()
      if (!label) throw new Error('title が空です。図のタイトル（何を示す図か）を指定してください')
      if (!visualizationStore) throw new Error('可視化ストアが利用できません')
      const { result, ids } = await draw({ code, datasetIds, width, height })
      const viz = visualizationStore.create({
        title: label,
        description: String(description ?? ''),
        datasetIds: ids,
        code: String(code),
        svg: result.svg,
        warnings: result.warnings,
        stats: result.stats,
        width: result.width,
        height: result.height,
      })
      announce(viz, 1, result)
      return summarizeRender({ vizId: viz.id, version: 1, title: viz.title, result })
    },

    async updateVisualization({ vizId, code, title, width, height, changeNote, description } = {}) {
      if (!visualizationStore) throw new Error('可視化ストアが利用できません')
      const id = String(vizId ?? '').trim()
      const current = visualizationStore.get(id)
      if (!current) {
        const known = visualizationStore.getSnapshot().map((v) => v.id)
        throw new Error(`可視化が見つかりません: ${id || '(空)'}（利用できるのは ${known.join(', ') || 'なし'}。新規なら render_visualization を使う）`)
      }
      const last = current.versions.at(-1)
      const { result, ids } = await draw({
        code,
        datasetIds: current.datasetIds,
        width: width ?? last?.width,
        height: height ?? last?.height,
      })
      const saved = visualizationStore.addVersion(id, {
        code: String(code),
        svg: result.svg,
        warnings: result.warnings,
        stats: result.stats,
        width: result.width,
        height: result.height,
        title,
        description,
        changeNote: String(changeNote ?? ''),
      })
      const version = saved.currentVersion
      announce(saved, version, result)
      return { ...summarizeRender({ vizId: id, version, title: saved.title, result }), datasetIds: ids }
    },
  }
}
