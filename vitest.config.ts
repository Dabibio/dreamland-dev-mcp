import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // 我们的 fetch stub / tmpdir 临时目录都要短时跑;不开并行避免相互踩 stub。
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
})
