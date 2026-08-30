import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.{test,spec}.ts"],
    // 現状のテストはロジック層のみ（storage は Map スタブを注入）。
    // DOM を直接検証するテストを足すときは、そのファイルだけ
    // `// @vitest-environment jsdom` を付ける。
    environment: "node",
  },
});
