import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// 単一の自己完結 HTML を出力する（iPad の「ホーム画面に追加」運用のため）。
export default defineConfig({
  plugins: [viteSingleFile()],
});
