import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { describeProject } from '../../project/index.ts';
import {
  formatGateDescription,
  renderCheckReporter,
  renderProveReporter,
  type ProveReporterName,
  type ReporterSpec,
} from '../../reporter/index.ts';
import { checkProject, proveProject } from '../../run/index.ts';
import { DEFAULT_CONFIG_FILES, HELP, noConfigMessage, parseArguments } from '../core/arguments.ts';

async function defaultConfigPath(): Promise<string | null> {
  for (const file of DEFAULT_CONFIG_FILES) {
    const path = resolve(file);
    if (await stat(path).then(entry => entry.isFile(), () => false)) return path;
  }
  return null;
}

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

async function emit(spec: ReporterSpec, text: string, projectRoot: string): Promise<void> {
  if (!spec.outputFile) {
    if (text) process.stdout.write(`${text}\n`);
    return;
  }

  const file = isAbsolute(spec.outputFile) ? spec.outputFile : resolve(projectRoot, spec.outputFile);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const invocation = parseArguments(argv, process.stdout.isTTY);

  if (invocation.kind === 'help') {
    console.log(HELP);
    return 0;
  }
  if (invocation.kind === 'version') {
    console.log(await packageVersion());
    return 0;
  }
  if (invocation.kind === 'usage-error') {
    console.error(invocation.message);
    return 2;
  }

  const configPath = invocation.configPath === null
    ? await defaultConfigPath()
    : resolve(invocation.configPath);
  if (configPath === null) {
    console.error(noConfigMessage(process.cwd()));
    return 2;
  }

  if (invocation.command === 'describe') {
    const run = await describeProject(configPath, invocation.gateFiles);
    console.log(run.descriptions.map(formatGateDescription).join('\n\n'));
    return 0;
  }

  if (invocation.command === 'prove') {
    const run = await proveProject(configPath, invocation.gateFiles);
    for (const spec of invocation.reporters) {
      await emit(spec, renderProveReporter(spec.name as ProveReporterName, run), run.project.root);
    }
    return run.exitCode;
  }

  const run = await checkProject(configPath, invocation.gateFiles);
  for (const spec of invocation.reporters) {
    const output = await renderCheckReporter(spec.name, run, {
      color: invocation.color,
      verbose: invocation.verbose,
    });
    await emit(spec, output, run.project.root);
  }
  return run.exitCode;
}
