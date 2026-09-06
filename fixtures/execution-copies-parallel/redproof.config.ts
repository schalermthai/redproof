import { defineConfig } from 'redproof';

export default defineConfig({
  root: '.',
  gatesRoot: 'gates/**/*.ts',
  refusalExit: 2,
  execution: {
    mode: 'copies',
    maxAtOnce: 3,
  },
});
