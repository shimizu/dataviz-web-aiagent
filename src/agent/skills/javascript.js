// JS 実行ツールのスキル（Markdown 文字列・決定的）。
//
// 役割: execute_javascript をいつ・どう使うかと、隔離環境の制約を Claude に教える。
//       現在日時などの揮発情報は書かない（安定プレフィックスとしてキャッシュされるため）。
// 関係: tools/javascript/index.js が skills に載せる。
export const JAVASCRIPT_SKILL = `# スキル: JavaScript 実行（execute_javascript）

他のツールでは表現できない計算・集計・加工を、隔離された使い捨て Web Worker 上で JavaScript として実行する。
既存のツールで足りるならそちらを優先し、必要な場合だけ使う。

## コードの形
\`\`\`js
// 目的: 何を対象に何を計算するかを日本語で 1 行書く（実行ログの識別に使う）
function analyze({ records, columns, metadata, datasets, args }) {
  // ここで集計する
  return { columns: ['name', 'value'], rows: [['a', 1]], notes: ['注意書き'] }
}
\`\`\`
- \`analyze\` という名前の関数を必ず定義する（他の名前だとエラー）。先頭行の日本語コメントは必須。
- 返り値は JSON 互換の \`{ columns, rows, notes }\`。関数・undefined・循環参照は返せない。
  \`columns\` は列名の配列、\`rows\` は行の配列、\`notes\` は警告や補足の文字列配列（省略可）。
- \`records\` / \`columns\` / \`metadata\` は \`datasetId\` で指定した主データセット。\`datasetIds\` を指定すると
  \`datasets[datasetId].records\` で複数を同時参照できる。データセットを扱わないアプリでは \`records\` は空配列なので、
  必要な値は \`args\` に渡す。

## 使えないもの
- ネットワーク・ストレージ: \`fetch\` / \`XMLHttpRequest\` / \`WebSocket\` / \`EventSource\` / \`importScripts\` /
  動的 \`import()\` / \`indexedDB\` / \`localStorage\` / \`sessionStorage\` / \`postMessage\`。実行前検査で拒否される。
- DOM・API キーは Worker に渡らない。外部からデータを取ってくる用途には使えない（データ取得は他のツールの仕事）。

## 制限
- 実行時間 5 秒（超えると timeout）。無限ループや全件の総当たりを書かない。
- 入力レコードは合計 200,000 件まで、出力は 1MB まで。大きい結果は集計して返す。
- 返るのは先頭 20 行と件数・警告だけ。全行は表示側が持つので、行を全部読もうとしない。

## エラーが返ったら
\`rejected\`（禁止参照・入力上限）/ \`timeout\` / \`error\`（例外・出力の形）のいずれかがメッセージに入る。
メッセージを読んでコードを直し、同じ内容を投げ直さない。`
