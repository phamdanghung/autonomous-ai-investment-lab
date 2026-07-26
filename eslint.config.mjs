import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";

export default [
  js.configs.recommended,
  {
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "no-undef": "off", // Let TypeScript handle undefined variables
      "no-unused-vars": "off" // Let TypeScript handle unused variables, or we can use typescript-eslint
    },
  },
  {
    ignores: [".next/**", "node_modules/**", "dist/**", "scratch/**", "coverage/**"]
  }
];
