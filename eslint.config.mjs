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
    // Claude Code 的 worktree 是完整仓库副本（.gitignore 已忽略）。不排除的话
    // `npm run lint` 会在任何存在 worktree 的机器上报几十条来自副本的错误，
    // lint 门禁就取决于磁盘上有没有别人的工作副本，而不是这份代码。
    ".claude/**",
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
