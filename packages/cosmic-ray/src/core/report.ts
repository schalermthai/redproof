import { isAbsolute, relative, resolve, sep } from 'node:path';

export type CosmicRayStatus =
  | 'killed'
  | 'survived'
  /** The test command ran past `timeout`. cosmic-ray records this as a kill, so it is told apart by its output. */
  | 'timeout'
  /** The job has no result yet (`exec` did not finish it). */
  | 'pending'
  /** The worker or the test launch failed, so the job says nothing about the tests. */
  | 'invalid';

export type CosmicRayMutant = {
  readonly id: string;
  readonly status: CosmicRayStatus;
  /** Path of the mutated module, exactly as cosmic-ray reported it. */
  readonly modulePath: string;
  readonly operator: string;
  /** One-based line and zero-based column of the mutation start, as cosmic-ray reports them. */
  readonly line: number;
  readonly column: number;
  readonly diff?: string;
  /** Why a job is `invalid`, for the refusal detail. */
  readonly reason?: string;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const EXIT_MARKER = /^REDPROOF-EXIT (\d+)\n/u;

/** The first line of the recorded output, which the driver (not the code under test) writes. */
function firstLine(output: unknown): string {
  return typeof output === 'string' ? output.split('\n', 1)[0] ?? '' : '';
}

function status(result: unknown): { readonly status: CosmicRayStatus; readonly reason?: string } {
  if (result === null) return { status: 'pending' };
  if (!isRecord(result)) return { status: 'invalid', reason: 'result is not an object' };
  if (result.worker_outcome !== 'normal') {
    return { status: 'invalid', reason: `worker outcome ${String(result.worker_outcome)}` };
  }
  if (result.test_outcome === 'survived') return { status: 'survived' };
  if (result.test_outcome === 'killed') {
    if (result.output === 'timeout') return { status: 'timeout' };
    // cosmic-ray calls every non-zero exit AND every signal death `killed`. Only the driver's marker, written by the cosmic-ray
    // worker, says the runner exited with its own failure code; output is never used to guess.
    const marker = typeof result.output === 'string' ? EXIT_MARKER.exec(result.output) : null;
    if (marker !== null && Number(marker[1]) > 0) return { status: 'killed' };
    return { status: 'invalid', reason: `killed without a runner failure code (${firstLine(result.output) || 'no output'}); the test process may have been signalled, or the run was not made through the Redproof driver` };
  }
  return { status: 'invalid', reason: `test outcome ${String(result.test_outcome)} (${firstLine(result.output) || 'no output'})` };
}

function parseLine(text: string, index: number): CosmicRayMutant | Error {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return new Error(`Line ${index + 1} of the cosmic-ray dump is not JSON.`);
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || !isRecord(parsed[0])) {
    return new Error(`Line ${index + 1} of the cosmic-ray dump is not a [work item, result] pair.`);
  }
  const item = parsed[0];
  const mutation = Array.isArray(item.mutations) ? item.mutations[0] : undefined;
  if (typeof item.job_id !== 'string' || !isRecord(mutation)) {
    return new Error(`Line ${index + 1} of the cosmic-ray dump has no job id or mutation.`);
  }
  const start = mutation.start_pos;
  if (typeof mutation.module_path !== 'string' || typeof mutation.operator_name !== 'string'
    || !Array.isArray(start) || !Number.isInteger(start[0]) || !Number.isInteger(start[1])) {
    return new Error(`Line ${index + 1} of the cosmic-ray dump has an incomplete mutation.`);
  }
  const outcome = status(parsed[1]);
  const diff = isRecord(parsed[1]) && typeof parsed[1].diff === 'string' ? parsed[1].diff : undefined;
  return {
    id: item.job_id,
    status: outcome.status,
    modulePath: mutation.module_path,
    operator: mutation.operator_name,
    line: start[0] as number,
    column: start[1] as number,
    ...(diff ? { diff } : {}),
    ...(outcome.reason ? { reason: outcome.reason } : {}),
  };
}

/** Parse `cosmic-ray dump` output: one `[work item, result | null]` JSON array per line. */
export function parseCosmicRayDump(text: string): readonly CosmicRayMutant[] | Error {
  const mutants: CosmicRayMutant[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (line.trim() === '') continue;
    const mutant = parseLine(line, index);
    if (mutant instanceof Error) return mutant;
    mutants.push(mutant);
  }
  return mutants;
}

/** A module path as a portable path below the Gate root; null when it points outside. Both directories are absolute. */
export function moduleFileInsideRoot(root: string, cwd: string, modulePath: string): string | null {
  const absolute = resolve(cwd, modulePath);
  const rel = relative(root, absolute);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
}

function identity(mutant: CosmicRayMutant): string {
  return [mutant.id, mutant.modulePath, mutant.operator, mutant.line, mutant.column].join('\u0000');
}

/** True when the final dump does not describe exactly the jobs that were planned: same ids, same modules, operators and positions. */
export function jobsDiffer(planned: readonly CosmicRayMutant[], final: readonly CosmicRayMutant[]): boolean {
  if (planned.length !== final.length) return true;
  const identities = new Set(planned.map(identity));
  return identities.size !== planned.length || final.some(mutant => !identities.has(identity(mutant)));
}
