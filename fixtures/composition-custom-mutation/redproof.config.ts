import { defineConfig } from 'redproof';

export default defineConfig({
  root: '.',
  gatesRoot: 'gates/**/*.ts',
  execution: { mode: 'copies', maxAtOnce: 2 },
});
