#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
const color = process.stdout.isTTY && !args.includes('--no-color');
const verbose = args.includes('--verbose');

const HELP = `Usage: redproof [command] [options]

Commands:
  check       Run all discovered Gates (default)
  prove       Run all discovered Proofs
  describe    Describe discovered Gates

Options:
  --config <path>       Path to redproof.config.ts
  --reporter <reporter> Select an output reporter
  --outputFile <path>   Write reporter output to a file
  --no-color            Disable colored output
  --verbose             Include passing details
  -h, --help            Show this help
  -v, --version         Show the installed version`;

function configArg(argv: readonly string[]): string | undefined {
  const inline = argv.find(arg => arg.startsWith('--config='));
  if (inline !== undefined) return inline.slice('--config='.length) || undefined;

  const index = argv.indexOf('--config');
  if (index < 0) return 'redproof.config.ts';
  const value = argv[index + 1];
  return value && !value.startsWith('-') ? value : undefined;
}

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

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

async function main(): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(HELP);
    return 0;
  }

  if (args.includes('--version') || args.includes('-v')) {
    console.log(await packageVersion());
    return 0;
  }

  const configValue = configArg(args);
  if (configValue === undefined) {
    console.error('Option --config requires a path.');
    return 2;
  }
  const configPath = resolve(configValue);

  if (command === 'describe') {
    const [gateFile] = positionalArgs(args);
    const run = await describeProject(configPath, gateFile);
    console.log(run.descriptions.map(formatGateDescription).join('\n\n'));
    return 0;
  }

  if (command === 'prove') {
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
    return run.exitCode;
  }

  if (command === 'check') {
    const specs = parseReporterArgs(args);
    const run = await checkProject(configPath);
    for (const spec of specs) {
      const output = await renderCheckReporter(spec.name, run, { color, verbose });
      await emit(spec, output, run.project.root);
    }
    return run.exitCode;
  }

  console.error(`Unknown command: ${command}`);
  return 2;
}

process.exitCode = await main();
