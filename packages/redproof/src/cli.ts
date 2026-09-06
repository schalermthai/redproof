#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { describeProject } from './runtime/describe.ts';
import {
  formatGateDescription,
  parseReporterArgs,
  renderCheckReporter,
  renderProveReporter,
  type ProveReporterName,
  type ReporterSpec,
} from './reporter/index.ts';
import { checkProject, proveProject } from './runtime/run.ts';

const args = process.argv.slice(2);
const command = args[0] ?? 'check';
const configIndex = args.indexOf('--config');
const configPath = resolve(configIndex >= 0 ? args[configIndex + 1]! : 'redproof.config.ts');
const color = process.stdout.isTTY && !args.includes('--no-color');
const verbose = args.includes('--verbose');

function positionalArgs(argv: readonly string[]): readonly string[] {
  const positionals: string[] = [];

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === '--config' || arg === '--outputFile') {
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) continue;
    positionals.push(arg);
  }

  return positionals;
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

if (command === 'describe') {
  const [gateFile] = positionalArgs(args);
  const run = await describeProject(configPath, gateFile);
  console.log(run.descriptions.map(formatGateDescription).join('\n\n'));
} else if (command === 'prove') {
  const specs = parseReporterArgs(args);
  for (const spec of specs) {
    if (spec.name !== 'default' && spec.name !== 'json') {
      throw new Error(`Reporter ${spec.name} does not support the prove command.`);
    }
  }

  const run = await proveProject(configPath);
  for (const spec of specs) {
    await emit(spec, renderProveReporter(spec.name as ProveReporterName, run), run.project.root);
  }
  process.exitCode = run.exitCode;
} else if (command === 'check') {
  const specs = parseReporterArgs(args);
  const run = await checkProject(configPath);
  for (const spec of specs) {
    const output = await renderCheckReporter(spec.name, run, { color, verbose });
    await emit(spec, output, run.project.root);
  }
  process.exitCode = run.exitCode;
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 2;
}
