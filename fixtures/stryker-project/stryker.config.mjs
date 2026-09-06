export default {
  mutate: ['src/is-adult.js'],
  testRunner: 'command',
  commandRunner: {
    command: 'node --test test/*.test.js',
  },
  concurrency: 1,
  thresholds: {
    high: 100,
    low: 100,
    break: null,
  },
};
