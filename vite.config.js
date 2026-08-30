import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 本番ビルドの index.html へ CSP の meta を注入する。
// - script-src: 'self' のみ。シェルはコードを動的実行しないので 'unsafe-eval' は不要
//   （ドメイン側で new Function 等を使うなら追加する）。
// - connect-src: Claude API（api.anthropic.com）と Gemini Live（generativelanguage.googleapis.com の https/wss）。
//   外部ホストを増やしたら必ずここへ足す（dev は CSP 非適用なので本番だけで壊れる）。
// - worker-src: AudioWorklet（pcm-worklet.js）は同一オリジンの実ファイルとして読み込む。
// - style-src: React のインラインスタイル用に 'unsafe-inline'。
// 開発時(serve)は Vite/HMR がインライン script を注入するため適用しない。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "connect-src 'self' https://api.anthropic.com https://generativelanguage.googleapis.com wss://generativelanguage.googleapis.com",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "base-uri 'self'",
  "object-src 'none'",
].join('; ')

function cspPlugin() {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '</title>',
        `</title>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      )
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), cspPlugin()],
  build: {
    // AudioWorklet のソースは必ず実ファイルとして出す。data: URL にインライン化されると
    // worklet のモジュール取得は script-src の対象なので CSP（data: 不許可）で
    // "Unable to load a worklet's module." になる。
    assetsInlineLimit: (filePath) => (filePath.endsWith('pcm-worklet.js') ? false : undefined),
    sourcemap: true,
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 20 }],
        },
      },
    },
  },
})
