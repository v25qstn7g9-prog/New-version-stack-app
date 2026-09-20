import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.{js,jsx}"],
    plugins: { react, "react-hooks": reactHooks },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.es2021 },
    },
    settings: { react: { version: "18.3" } },
    rules: {
      ...react.configs.recommended.rules,
      // Only the two long-standing hook-correctness rules — not the newer
      // React Compiler-oriented preset (purity/immutability/etc.), which
      // flags idiomatic pre-existing patterns unrelated to this refactor.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-unused-vars": "off",
      "react/prop-types": "off",
      "react/react-in-jsx-scope": "off",
      // This app's UI text is Traditional Chinese; full-width CJK spaces are
      // legitimate content, not accidental whitespace.
      "no-irregular-whitespace": "off",
      "no-undef": "error",
    },
  },
];
