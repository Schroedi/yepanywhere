// ESLint lints only authored CSS here; Biome owns TypeScript/JavaScript lint
// and all formatting. Rule choices and rejections: topics/css-architecture.md
// § CSS lint rules.
import cssicorn from "eslint-cssicorn";
import { defineConfig } from "eslint/config";

// packages/desktop is outside Biome's scope as well; mockups are throwaway.
const authoredCss = ["packages/client/src/**/*.css", "site/src/**/*.css"];

// Frozen legacy global stylesheets (scripts/css-architecture-baseline.json).
const legacyGlobalCss = [
  "packages/client/src/styles/index.css",
  "packages/client/src/styles/renderers.css",
  "packages/client/src/styles/tool-rows.css",
  "packages/client/src/styles/emulator.css",
];

export default defineConfig([
  {
    ...cssicorn.configs.all,
    files: authoredCss,
  },
  {
    files: authoredCss,
    rules: {
      // Rejected as style churn with no defect prevented.
      "cssicorn/lowercase": "off",
      "cssicorn/prefer-modern-syntax": "off",
      "cssicorn/prefer-short-hex-color": "off",
    },
  },
  {
    // Biome enforces this for CSS Modules too. The legacy files stay exempt
    // until their remaining out-of-order owners move into modules; see
    // gaps/legacy-css-descending-specificity.md.
    files: legacyGlobalCss,
    rules: {
      "cssicorn/no-descending-specificity": "off",
    },
  },
]);
