import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}', 'app/**/*.test.{ts,tsx}', 'components/**/*.test.{ts,tsx}', 'lib/**/*.test.{ts,tsx}'],
    exclude: ['.worktrees/**', '规航AI-源码-后端联调-20260717/**', 'node_modules/**'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      thresholds: {
        // 这些阈值是当前代码覆盖率基线(首次启用 coverage gate;main 此前在
        // lint/typecheck 步骤即失败,从未真正校验过 coverage)。作为回归底线,
        // 拒绝后续下滑;提升应靠补测试,勿再下调。
        // 首次实测:statements 79.56 / branches 65.82 / functions 77.06 / lines 81.42
        statements: 79,
        branches: 65,
        functions: 76,
        lines: 80,
      },
      exclude: [
        'node_modules/**',
        '.next/**',
        'tests/**',
        '**/*.d.ts',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
})