// JS 実行ツールの定義（Claude へ渡す JSON スキーマ）。
//
// 役割: execute_javascript の名前・説明・input_schema。データセット provider（deps.getDataset）が
//       注入されているときだけ datasetId / datasetIds を公開する（無いのに見せて誤用させない）。
// 関係: index.js が deps を見て定義を組み立て、registry へ登録する。実装は handlers.js。
export const EXECUTE_JAVASCRIPT = 'execute_javascript'

const CODE_DESCRIPTION =
  'analyze 関数を定義する JavaScript。JSON 互換の { columns, rows, notes } を返す。' +
  '先頭行に分析の目的を説明する日本語コメント（例: // 目的: ...）を必ず含めること'

const BASE_DESCRIPTION =
  '他のツールでは表現できない計算・集計・加工を、隔離された使い捨て Web Worker 上で JavaScript として実行する。' +
  'コードは function analyze(input) { return { columns, rows, notes } } の形式で書く。' +
  'fetch などのネットワーク・ストレージ API は使えない（実行前に拒否される）。DOM・API キーも渡されない。' +
  '既存のツールで足りるならそちらを優先し、必要な場合だけ使う。'

const WITH_DATASETS =
  ' input は { records, columns, metadata, datasets, args }。records / columns / metadata は datasetId で指定した主データセット。' +
  '複数の保存済みデータセットを比較・結合する場合は datasetIds を指定し、datasets[datasetId].records を参照する。'

const WITHOUT_DATASETS = ' input は { records, columns, metadata, args }。データは args に渡した値だけで、records は空配列になる。'

// hasDatasets: deps.getDataset が注入されているか。
export function buildJavascriptToolDefinition({ hasDatasets = false } = {}) {
  return {
    name: EXECUTE_JAVASCRIPT,
    description: BASE_DESCRIPTION + (hasDatasets ? WITH_DATASETS : WITHOUT_DATASETS),
    input_schema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: CODE_DESCRIPTION },
        ...(hasDatasets
          ? {
              datasetId: { type: 'string', description: '主データセットの ID（records / columns / metadata に入る）' },
              datasetIds: {
                type: 'array',
                items: { type: 'string' },
                minItems: 1,
                uniqueItems: true,
                description:
                  '複数の保存済みデータセットを同じコードから参照する場合の ID 配列。指定時も datasetId は主データセットとして records へ渡される',
              },
            }
          : {}),
        args: { type: 'object', description: 'analyze へ渡す追加引数（任意）', additionalProperties: true },
      },
      required: ['code'],
    },
  }
}
