export default {
  test: {
    include: ['test/**/*.test.js'],
    globalSetup: './global-setup.js',
    reporters: ['json'],
    outputFile: 'results.json',
  },
};
