// エントリポイント。React 19 の createRoot でアプリをマウントする。
import { createRoot } from 'react-dom/client'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(<App />)
