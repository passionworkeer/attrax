import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "rag_service/.venv/**",
    ".runvenv/**",
    "coverage/**",
    // Manual test scripts (CommonJS, not part of npm test):
    "test-doc-upload/**",
    "tests/pressure/**",
    "tests/e2e/*.js",
    "tests/e2e/*.mjs",
  ]),
  {
    files: ["tests/**/*.ts", "tests/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    // pm2 ecosystem configs and other .cjs files are CommonJS by definition —
    // `require()` is the correct syntax there, not a mistake. Without this
    // override `scripts/ecosystem.config.cjs` fails `npm run lint` (and with
    // it the CI frontend gate) the moment it needs a Node builtin.
    files: ["**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
]);

export default eslintConfig;
