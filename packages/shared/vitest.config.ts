import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // There is nothing to run here: the only test in this package is a type test,
    // and `--typecheck` is how vitest reports one.
    includeSource: [],
    include: [],
    typecheck: {
      enabled: true,
      include: ['src/**/*.test-d.ts'],
      tsconfig: './tsconfig.json',
    },
  },
});
