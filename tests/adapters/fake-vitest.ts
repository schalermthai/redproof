import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * vitest() starts `<command> run --reporter=json --no-cache ...`. With
 * `command: process.execPath`, Node loads `./run` from the working directory
 * as the main module, so a file named `run` stands in for Vitest.
 */
export async function installFakeVitest(project: string, script: string): Promise<void> {
  await mkdir(project, { recursive: true });
  await writeFile(join(project, 'run'), script, 'utf8');
}

/** A run that writes `report` to `relativePath` below the working directory, creating directories. */
export function writesReport(relativePath: string, report: string, extra = ''): string {
  return `
    const fs = require('node:fs');
    const path = require('node:path');
    const target = path.resolve(${JSON.stringify(relativePath)});
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, ${JSON.stringify(report)});
    ${extra}
  `;
}

/** A run that writes `report` to the private --outputFile path Redproof passes. */
export function writesPrivateReport(report: string): string {
  return `
    const fs = require('node:fs');
    const target = process.argv.find(arg => arg.startsWith('--outputFile=')).slice('--outputFile='.length);
    fs.writeFileSync(target, ${JSON.stringify(report)});
  `;
}

/** A run that only records that it was started, in `marker`. */
export function touches(marker: string): string {
  return `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '');`;
}

export function jestReport(assertions: readonly Record<string, unknown>[], file = '/repo/test/example.test.ts'): string {
  return JSON.stringify({
    numTotalTests: assertions.length,
    numFailedTests: assertions.filter(item => item.status === 'failed').length,
    testResults: [{ name: file, assertionResults: assertions }],
  });
}

export const passingReport = jestReport([{ title: 'works', status: 'passed' }]);
export const failingReport = jestReport([{ title: 'breaks', status: 'failed', failureMessages: ['expected 1 to be 2'] }]);
