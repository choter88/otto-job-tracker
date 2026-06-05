// Surgical ESLint config: its ONLY job is to catch React Rules-of-Hooks
// violations (e.g. a hook called after an early return) at lint time — the class
// of bug that shipped as the v1.7.16 "Minified React error #310" crash, which
// `tsc` and the production build do NOT catch. Intentionally not a full
// style/lint setup, so `npm run lint` stays signal (real hook bugs) not noise.
import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

export default [
  {
    files: ["client/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
