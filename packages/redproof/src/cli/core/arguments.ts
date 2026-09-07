import { parseReporterArgs, type ReporterSpec } from '../../reporter/core/index.ts';

export const HELP = `Usage: redproof [command] [gate files...] [options]

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

export const DEFAULT_CONFIG_FILES = [
  'redproof.config.ts',
  'redproof.config.mts',
  'redproof.config.mjs',
  'redproof.config.cts',
  'redproof.config.cjs',
  'redproof.config.js',
] as const;

export type CliCommand = 'check' | 'prove' | 'describe';

export type CliInvocation =
  | { readonly kind: 'help' }
  | { readonly kind: 'version' }
  | { readonly kind: 'usage-error'; readonly message: string }
  | {
      readonly kind: 'run';
      readonly command: CliCommand;
      /** An explicit --config path, or null to search the working directory. */
      readonly configPath: string | null;
      readonly gateFiles: readonly string[];
      readonly reporters: readonly ReporterSpec[];
      readonly color: boolean;
      readonly verbose: boolean;
    };

const COMMANDS: readonly CliCommand[] = ['check', 'prove', 'describe'];
const FLAGS_TAKING_A_VALUE = new Set(['--config', '--outputFile', '--reporter']);

function configArg(argv: readonly string[]): string | null | undefined {
  const inline = argv.find(arg => arg.startsWith('--config='));
  if (inline !== undefined) return inline.slice('--config='.length) || undefined;

  const index = argv.indexOf('--config');
  if (index < 0) return null;
  const value = argv[index + 1];
  return value && !value.startsWith('-') ? value : undefined;
}

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

function isCommand(value: string): value is CliCommand {
  return (COMMANDS as readonly string[]).includes(value);
}

export function parseArguments(argv: readonly string[], stdoutIsTty: boolean): CliInvocation {
  if (argv.includes('--help') || argv.includes('-h')) return { kind: 'help' };
  if (argv.includes('--version') || argv.includes('-v')) return { kind: 'version' };

  const configPath = configArg(argv);
  if (configPath === undefined) return { kind: 'usage-error', message: 'Option --config requires a path.' };

  const command = argv[0] ?? 'check';
  if (!isCommand(command)) return { kind: 'usage-error', message: `Unknown command: ${command}` };

  const reporters = command === 'describe' ? [] : parseReporterArgs(argv);
  if (command === 'prove') {
    for (const spec of reporters) {
      if (spec.name !== 'default' && spec.name !== 'json') {
        throw new Error(`Reporter ${spec.name} does not support the prove command.`);
      }
    }
  }

  return {
    kind: 'run',
    command,
    configPath,
    gateFiles: positionalArgs(argv),
    reporters,
    color: stdoutIsTty && !argv.includes('--no-color'),
    verbose: argv.includes('--verbose'),
  };
}

export function noConfigMessage(cwd: string): string {
  return `No Redproof config found in ${cwd}.\n`
    + `Looked for ${DEFAULT_CONFIG_FILES.join(', ')}.\n`
    + 'Create one, or pass --config <path>.';
}
