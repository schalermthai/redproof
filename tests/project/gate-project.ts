import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Write a self-contained Gate project. Its Gates are plain ESM objects, so
 * the project needs no node_modules and can live in a temporary directory.
 * Returns the absolute path of the config file.
 */
export async function writeProject(
  root: string,
  project: {
    readonly config?: Readonly<Record<string, unknown>>;
    readonly configFile?: string;
    readonly files?: Readonly<Record<string, string>>;
  },
): Promise<string> {
  for (const [file, content] of Object.entries(project.files ?? {})) {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, 'utf8');
  }

  const configFile = join(root, project.configFile ?? 'redproof.config.mjs');
  await mkdir(dirname(configFile), { recursive: true });
  const config = { gatesRoot: 'gates/**/*.mjs', ...project.config };
  await writeFile(configFile, `export default ${JSON.stringify(config)};\n`, 'utf8');
  return configFile;
}

/** Proof entries for a state Gate, as JavaScript source. They refer to helpers the Gate module defines. */
export const proofSource = {
  red: (name: string, gateId: string) =>
    `{ expected: 'red', name: ${JSON.stringify(name)}, target: '${gateId}/clean', mutate: appendBad(true) }`,
  redWithBrokenUndo: (name: string, gateId: string) =>
    `{ expected: 'red', name: ${JSON.stringify(name)}, target: '${gateId}/clean', mutate: appendBad(false) }`,
  green: (name: string) => `{ expected: 'green', name: ${JSON.stringify(name)} }`,
};

export type StateGateOptions = {
  readonly id: string;
  /** Milliseconds the Check waits before it reads, so concurrent Checks visibly overlap. */
  readonly delayMs?: number;
  /** A file the Check writes into ctx.root, to show which tree it ran against. */
  readonly marker?: string;
  readonly proofs?: readonly string[];
};

/**
 * A Gate that FAILs when src/state.txt contains BAD and PASSes otherwise.
 * Its scan source records the pid of the process that ran the Check.
 */
export function stateGateModule(options: StateGateOptions): string {
  const marker = options.marker
    ? `await writeFile(resolve(ctx.root, ${JSON.stringify(options.marker)}), ctx.root);`
    : '';
  const proofs = options.proofs
    ? `export const proofs = { gate, proofs: [${options.proofs.join(', ')}] };`
    : '';

  return `import { appendFile, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const clean = { id: '${options.id}/clean', description: 'src/state.txt must not contain BAD' };

const gate = {
  id: '${options.id}',
  adapter: {
    kind: 'fixture',
    rules: { clean },
    check: {
      description: 'inspect src/state.txt for a BAD marker',
      counting: { kind: 'supported' },
      async run(ctx) {
        const startedAt = new Date().toISOString();
        await delay(${options.delayMs ?? 0});
        ${marker}
        const text = await readFile(resolve(ctx.root, 'src/state.txt'), 'utf8');
        const scan = { source: 'pid:' + process.pid, startedAt, finishedAt: new Date().toISOString(), inspected: 1 };
        if (!text.includes('BAD')) return { verdict: 'pass', scan };
        return {
          verdict: 'fail',
          scan,
          breaches: [{ rule: clean.id, code: 'bad-marker', message: 'BAD marker found.', location: null }],
        };
      },
    },
  },
};

function appendBad(restore) {
  return {
    description: 'append BAD to src/state.txt',
    async apply(root) {
      const file = resolve(root, 'src/state.txt');
      const before = await readFile(file, 'utf8');
      await appendFile(file, 'BAD\\n');
      return restore ? async () => { await writeFile(file, before); } : async () => {};
    },
  };
}

export default gate;
${proofs}
`;
}

/** A Gate whose Check always returns the given verdict. */
export function verdictGateModule(id: string, verdict: 'pass' | 'fail' | 'refuse'): string {
  const results = {
    pass: "return { verdict: 'pass', scan: scan() };",
    fail: "return { verdict: 'fail', scan: scan(), breaches: [{ rule: rule.id, code: 'always-fail', message: 'This Gate always fails.', location: null }] };",
    refuse: "return { verdict: 'refuse', scan: scan(), why: { code: 'always-refuse', message: 'This Gate always refuses.', location: null } };",
  };

  return `const rule = { id: '${id}/rule', description: 'the rule of ${id}' };

function scan() {
  const at = new Date().toISOString();
  return { source: 'pid:' + process.pid, startedAt: at, finishedAt: at, inspected: 1 };
}

export default {
  id: '${id}',
  adapter: {
    kind: 'fixture',
    rules: { rule },
    check: {
      description: 'always ${verdict}',
      counting: { kind: 'supported' },
      async run() { ${results[verdict]} },
    },
  },
};
`;
}

/** A Gate whose Check throws instead of returning a verdict. */
export function throwingGateModule(id: string, message: string): string {
  return `export default {
  id: '${id}',
  adapter: {
    kind: 'fixture',
    rules: { rule: { id: '${id}/rule', description: 'the rule of ${id}' } },
    check: {
      description: 'throw',
      counting: { kind: 'supported' },
      async run() { throw new Error(${JSON.stringify(message)}); },
    },
  },
};
`;
}
