export type CheckReporterName = 'default' | 'compact' | 'json' | 'sarif';
export type ProveReporterName = 'default' | 'json';
export type ReporterName = CheckReporterName;

export type ReporterSpec = {
  readonly name: ReporterName;
  readonly outputFile?: string;
};

const names = new Set(['default', 'compact', 'json', 'sarif']);

function valueAfter(args: readonly string[], index: number): string | undefined {
  return args[index + 1] && !args[index + 1]!.startsWith('--') ? args[index + 1] : undefined;
}

function parseReporterValue(value: string): ReporterSpec {
  const colon = value.indexOf(':');
  const name = colon < 0 ? value : value.slice(0, colon);
  const outputFile = colon < 0 ? undefined : value.slice(colon + 1);
  if (!names.has(name)) throw new Error(`Unknown reporter: ${name}`);
  if (colon >= 0 && !outputFile) throw new Error(`Reporter ${name} output path cannot be empty.`);
  return {
    name: name as ReporterSpec['name'],
    ...(outputFile ? { outputFile } : {}),
  };
}

/** Parse repeatable --reporter flags. `--outputFile` is shorthand for a single reporter. */
export function parseReporterArgs(args: readonly string[]): readonly ReporterSpec[] {
  const reporters: ReporterSpec[] = [];
  let outputFile: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === '--reporter') {
      const value = valueAfter(args, index);
      if (!value) throw new Error('--reporter requires a value.');
      reporters.push(parseReporterValue(value));
      index++;
    } else if (arg.startsWith('--reporter=')) {
      reporters.push(parseReporterValue(arg.slice('--reporter='.length)));
    } else if (arg === '--outputFile') {
      outputFile = valueAfter(args, index);
      if (!outputFile) throw new Error('--outputFile requires a value.');
      index++;
    } else if (arg.startsWith('--outputFile=')) {
      outputFile = arg.slice('--outputFile='.length);
      if (!outputFile) throw new Error('--outputFile requires a value.');
    }
  }

  if (reporters.length === 0) reporters.push({ name: 'default' });
  if (outputFile) {
    if (reporters.length !== 1) {
      throw new Error('--outputFile can only be used when exactly one reporter is selected. Use --reporter=name:path for multiple reporters.');
    }
    if (reporters[0]!.outputFile) throw new Error('Output file was specified twice.');
    reporters[0] = { ...reporters[0]!, outputFile };
  }

  const stdoutCount = reporters.filter(item => !item.outputFile).length;
  if (stdoutCount > 1) {
    throw new Error('At most one reporter may write to stdout. Give additional reporters an output path, for example --reporter=json:.redproof/results.json.');
  }

  return reporters;
}
