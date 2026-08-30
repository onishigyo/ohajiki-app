import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "node_modules"]),
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      // 本番コードでは明示 any を禁止（再混入を CI でブロック）。
      // 真に必要な稀なケースは
      // `// eslint-disable-next-line @typescript-eslint/no-explicit-any` ＋理由で個別許可。
      "@typescript-eslint/no-explicit-any": "error",
      // _ から始まる変数名（_event など）は未使用でも警告に留める。
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // 短絡評価（a && b() など）を許容。
      "@typescript-eslint/no-unused-expressions": "warn",
    },
  },
  {
    // 設定ファイルは Node グローバル。
    files: ["*.config.{ts,js}"],
    languageOptions: { globals: globals.node },
  },
  {
    // テストではフィクスチャ生成等のため any を許容。
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
]);
