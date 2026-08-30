// Blob をファイルとして保存させる（ブラウザ専用）。
//
// 役割: <a download> にオブジェクト URL を差してクリックし、後片付けする。
// 関係: App の DL ボタン（SVG / PNG / ZIP）。
export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  // クリック直後に revoke するとダウンロードが始まらない環境があるため少し待つ。
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return fileName
}
