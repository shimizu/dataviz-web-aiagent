// データ可視化ツールの定義（Claude へ渡す JSON スキーマ）。
//
// 役割: データセットの確認（list / describe）と、分析結果の保存（save_dataset）。
//       戻り値は必ず要約だけ（行データ・地物・ラスタはアプリ側のストアに残す）。
// 関係: index.js が registry に登録する。実装は dataset-handlers.js。描画ツールは M3 で足す。
export const LIST_DATASETS = 'list_datasets'
export const DESCRIBE_DATASET = 'describe_dataset'
export const SAVE_DATASET = 'save_dataset'

export const DATAVIZ_TOOL_DEFINITIONS = [
  {
    name: LIST_DATASETS,
    description:
      'ユーザーが読み込んだデータセットの一覧を返す。可視化や分析の依頼を受けたら**最初にこれを呼ぶ**。' +
      '返るのは ID・名前・種別（tabular / geojson / raster）・件数・列名だけ。中身の確認は describe_dataset を使う。',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: DESCRIBE_DATASET,
    description:
      '1 つのデータセットの構造を詳しく返す。列の型・欠損・最小最大・代表値、GeoJSON なら地物数と bbox と' +
      '**描画前に確認すべき診断（diagnostics）**、ラスタならサイズ・CRS・nodata・バンド統計。' +
      '可視化コードを書く前に、使う予定のデータセットについて必ず呼ぶ。',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'データセット ID（list_datasets の id）' },
        sample: { type: 'integer', description: 'サンプルとして返す行数 / 地物数（0〜20、既定 5）' },
        stats: { type: 'boolean', description: '列ごとの統計を含めるか（既定 true）' },
      },
      required: ['id'],
    },
  },
  {
    name: SAVE_DATASET,
    description:
      '直前に実行した execute_javascript の結果（全行）を、新しいデータセットとして保存する。' +
      '集計・結合・整形の結果をそのまま可視化に使いたいときに呼ぶ。codeHash は execute_javascript の戻り値のもの。' +
      '単に値を確認しただけなら保存しなくてよい。',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '保存名（例: 都道府県別の売上合計）' },
        codeHash: { type: 'string', description: '保存したい execute_javascript の戻り値にある codeHash' },
      },
      required: ['name', 'codeHash'],
    },
  },
]
