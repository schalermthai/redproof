import { defineConfig } from 'redproof';

export default defineConfig({
  root: '.',
  gatesRoot: 'gates/**/*.ts',
  refusalExit: 2,
});
