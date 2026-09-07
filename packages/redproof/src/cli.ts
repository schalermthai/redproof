#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { describeProject } from './runtime/describe.ts';
import { GateSelectionError } from './runtime/discovery.ts';
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

const HELP = `Usage: redproof [command] [gate files...] [options]

Commands:
  check       Run discovered Gates (default)
  prove       Run the Proofs of discovered Gates
  describe    Describe discovered Gates

Gate files select which Gates to operate on. With none, every discovered
Gate runs. A path that is not a discovered Gate is an error. Gate files
never change what a Gate inspects; a Gate owns its own scope.

  redproof check gates/no-todo.ts
  redproof prove gates/no-todo.ts gates/architecture.ts
  redproof check gates/*.ts

Options:
  --config <path>       Path to a Redproof config file. Without it, the CLI
                        looks for redproof.config.ts, .mts, .mjs, .cts, .cjs,
                        then .js, in that order.
  --reporter <reporter> Select an output reporter
  --outputFile <path>   Write reporter output to a file
  --no-color            Disable colored output
  --verbose             Include passing details
  -h, --help            Show this help
  -v, --version         Show the installed version`;

const DEFAULT_CONFIG_FILES = [
  'redproof.config.ts',
  'redproof.config.mts',
  'redproof.config.mjs',
  'redproof.config.cts',
  'redproof.config.cjs',
  'redproof.config.js',
] as const;

function configArg(argv: readonly string[]): string | null | undefined {
  const inline = argv.find(arg => arg.startsWith('--config='));
  if (inline !== undefined) return inline.slice('--config='.length) || undefined;

  const index = argv.indexOf('--config');
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith('-') ? value : undefined;
}

async function defaultConfigPath(): Promise<string | null> {
  for (const file of DEFAULT_CONFIG_FILES) {
    const path = resolve(file);
    if (await stat(path).then(entry => entry.isFile(), () => false)) return path;
  }
  return null;
}

async function packageVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return manifest.version;
}

const FLAGS_TAKING_A_VALUE = new Set(['--config', '--outputFile', '--reporter']);

function positionalArgs(argv: readonly string[]): readonly string[] {
  const positionals: string[] = [];

  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (FLAGS_TAKING_A_VALUE.has(arg)) {
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) continue;
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
  const discovered = configValue === null ? await defaultConfigPath() : resolve(configValue);
  if (discovered === null) {
    console.error(
      `No Redproof config found in ${process.cwd()}.\n`
      + `Looked for ${DEFAULT_CONFIG_FILES.join(', ')}.\n`
      + 'Create one, or pass --config <path>.',
    );
    return 2;
  }
  const configPath = discovered;

  const gateFiles = positionalArgs(args);

  if (command === 'describe') {
    const run = await describeProject(configPath, gateFiles);
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

    const run = await proveProject(configPath, gateFiles);
    for (const spec of specs) {
      await emit(spec, renderProveReporter(spec.name as ProveReporterName, run), run.project.root);
    }
    return run.exitCode;
  }

  if (command === 'check') {
    const specs = parseReporterArgs(args);
    const run = await checkProject(configPath, gateFiles);
    for (const spec of specs) {
      const output = await renderCheckReporter(spec.name, run, { color, verbose });
      await emit(spec, output, run.project.root);
    }
    return run.exitCode;
  }

  console.error(`Unknown command: ${command}`);
  return 2;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (!(error instanceof GateSelectionError)) throw error;
  console.error(error.message);
  process.exitCode = 2;
}
