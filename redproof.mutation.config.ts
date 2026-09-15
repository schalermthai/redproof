import { defineConfig } from 'redproof';

export default defineConfig({
  root: '.',
  gatesRoot: 'gates/mutation/*.ts',
  refusalExit: 2,
  execution: {
    mode: 'copies',
    maxAtOnce: 1,
  },
});
