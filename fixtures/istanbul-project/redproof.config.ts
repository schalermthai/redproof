import { defineConfig } from 'redproof';

const config = defineConfig({
  root: '.',
  gatesRoot: 'gates/**/*.ts',
  refusalExit: 2,
});

export default config;
