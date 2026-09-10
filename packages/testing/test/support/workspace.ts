import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function withWorkspace<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'redproof-testing-tck-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function installFakeVitest(project: string, script: string): Promise<void> {
  await mkdir(project, { recursive: true });
  await writeFile(join(project, 'run'), script, 'utf8');
}

export function writesPrivateReport(report: string): string {
  return `
    const fs = require('node:fs');
    const target = process.argv.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length);
    fs.writeFileSync(target, ${JSON.stringify(report)});
  `;
}

function jestReport(assertions: readonly Record<string, unknown>[]): string {
  return JSON.stringify({
    numTotalTests: assertions.length,
    numFailedTests: assertions.filter(item => item.status === 'failed').length,
    testResults: [{ name: '/repo/test/example.test.ts', assertionResults: assertions }],
  });
}

export const passingReport = jestReport([{ title: 'works', status: 'passed' }]);
export const failingReport = jestReport([{
  title: 'breaks',
  status: 'failed',
  failureMessages: ['expected 1 to be 2'],
}]);
