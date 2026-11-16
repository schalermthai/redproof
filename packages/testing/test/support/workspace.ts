import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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

/** An executable that stands in for pytest: it writes `xml` to the --junitxml path it is given. */
export async function installFakePytest(project: string, xml: string): Promise<string> {
  await mkdir(project, { recursive: true });
  const path = join(project, 'fake-pytest');
  await writeFile(path, `#!/usr/bin/env node
const fs = require('node:fs');
const target = process.argv.find(arg => arg.startsWith('--junitxml=')).slice('--junitxml='.length);
fs.writeFileSync(target, ${JSON.stringify(xml)});
`, 'utf8');
  await chmod(path, 0o755);
  return path;
}

function junit(testcases: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><testsuites><testsuite name="pytest">${testcases}</testsuite></testsuites>`;
}

export const pytestPassingXml = junit('<testcase classname="t" name="works"/>');
export const pytestFailingXml = junit('<testcase classname="t" name="breaks"><failure message="assert 1 == 2"/></testcase>');
export const pytestSkippedXml = junit('<testcase classname="t" name="later"><skipped type="pytest.skip" message="later"/></testcase>');
export const pytestXfailXml = junit('<testcase classname="t" name="known bug"><skipped type="pytest.xfail" message="known bug"/></testcase>');
