// ファイルのドロップ / 選択エリア（表示と入力のみ）。
//
// 役割: csv / tsv / geojson / geotiff を受け取り、onFiles(File[]) で親へ渡す。読み込み処理はここに書かない。
// 関係: DatavizWorkspace が配置し、App.jsx の importFiles に繋ぐ。
import { useCallback, useRef, useState } from 'react'

const ACCEPT = '.csv,.tsv,.tab,.txt,.geojson,.json,.tif,.tiff'

function DropZone({ onFiles, busy = false }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)

  const handleFiles = useCallback(
    (fileList) => {
      const files = [...(fileList ?? [])]
      if (files.length > 0) onFiles?.(files)
    },
    [onFiles],
  )

  return (
    <div
      className={`drop-zone${over ? ' over' : ''}${busy ? ' busy' : ''}`}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        handleFiles(e.dataTransfer?.files)
      }}
    >
      <p className="drop-zone-title">{busy ? '読み込み中…' : 'データファイルをドロップ'}</p>
      <p className="drop-zone-hint">csv / tsv / geojson / geotiff（複数可）</p>
      <button type="button" className="ghost-button" onClick={() => inputRef.current?.click()} disabled={busy}>
        ファイルを選ぶ
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          handleFiles(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

export default DropZone
