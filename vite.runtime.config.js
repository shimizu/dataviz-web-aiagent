import { defineConfig } from 'vite'

// viz-runtime.js（d3 + d3-geo-projection + d3-geo-polygon + turf + geoWarp）を IIFE 1 本で public/ に出す別設定。
// - 可視化フレーム（public/viz-frame.html）の <script src="./viz-runtime.js"> と、zip 書き出しの同梱ファイルで共用する。
// - public/ へ出すので copyPublicDir / publicDir を切る（自分自身を public → public へコピーしない）。
// - `npm run build:runtime` で単独実行。predev / prebuild からも呼ぶ。生成物は gitignore。
export default defineConfig({
  publicDir: false,
  build: {
    lib: {
      entry: 'src/viz-runtime/index.js',
      name: 'VizRuntime',
      formats: ['iife'],
      fileName: () => 'viz-runtime.js',
    },
    outDir: 'public',
    emptyOutDir: false,
    copyPublicDir: false,
    sourcemap: false,
    minify: true,
  },
})
