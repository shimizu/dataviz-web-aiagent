// データ可視化ツールの定義（Claude へ渡す JSON スキーマ）。
//
// 役割: データセットの確認（list / describe）と、分析結果の保存（save_dataset）。
//       戻り値は必ず要約だけ（行データ・地物・ラスタはアプリ側のストアに残す）。
// 関係: index.js が registry に登録する。実装は dataset-handlers.js / visualization-handlers.js。
export const LIST_DATASETS = 'list_datasets'
export const DESCRIBE_DATASET = 'describe_dataset'
export const SAVE_DATASET = 'save_dataset'
export const RENDER_VISUALIZATION = 'render_visualization'
export const UPDATE_VISUALIZATION = 'update_visualization'

const CODE_DESCRIPTION =
  'function render({ container, d3, turf, geoWarp, datasets, width, height, theme }) を定義する JavaScript。' +
  'container の中に <svg> を 1 つ作って描く。先頭行に「何を示す図か」を説明する日本語コメントを入れる。' +
  '外部通信・外部 CSS・アニメーションは使えない。datasets[<datasetId>] で渡したデータセットを参照する。'

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
  {
    name: RENDER_VISUALIZATION,
    description:
      'D3 の描画コードを隔離フレームで実行して可視化を作り、画面の「可視化」タブとチャットに表示する。' +
      'データを確認し、作る図が決まってから呼ぶ。戻り値は要約（要素数・警告・console）だけで、SVG 本体は返らない。' +
      '失敗したらエラーメッセージと console を読んでコードを直し、もう一度 render_visualization を呼ぶ。' +
      '既に作った図を直す場合は update_visualization を使う。',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '図のタイトル（何を示す図か。図中にも描く）' },
        code: { type: 'string', description: CODE_DESCRIPTION },
        datasetIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          uniqueItems: true,
          description: '使うデータセットの ID。ここに挙げたものだけが datasets に渡る',
        },
        width: { type: 'integer', description: '横幅 px（320〜4096、既定 960）' },
        height: { type: 'integer', description: '高さ px（320〜4096、既定 600）' },
        description: { type: 'string', description: '図の説明 1 行（読み取れることを書く）' },
      },
      required: ['title', 'code', 'datasetIds'],
    },
  },
  {
    name: UPDATE_VISUALIZATION,
    description:
      '既存の可視化を新しいコードで描き直して新しいバージョンとして保存する。' +
      '「色を変えて」「並び順を変えて」「凡例を足して」などの修正依頼で使う。使うデータセットは元のまま。' +
      'コードは差分ではなく **render 関数の全文**を渡す。',
    input_schema: {
      type: 'object',
      properties: {
        vizId: { type: 'string', description: '対象の可視化 ID（render_visualization の戻り値 vizId）' },
        code: { type: 'string', description: CODE_DESCRIPTION },
        title: { type: 'string', description: 'タイトルを変える場合' },
        width: { type: 'integer', description: '横幅 px（省略時は前のバージョンと同じ）' },
        height: { type: 'integer', description: '高さ px（省略時は前のバージョンと同じ）' },
        changeNote: { type: 'string', description: '何を変えたか 1 行' },
      },
      required: ['vizId', 'code'],
    },
  },
]
