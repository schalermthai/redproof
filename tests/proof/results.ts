import type {
  Breach,
  CheckResult,
  FailResult,
  PassResult,
  RefuseResult,
  Scan,
} from '../../packages/redproof/src/domain/index.ts';

export const scan: Scan = {
  source: 'unit',
  startedAt: '',
  finishedAt: '',
  inspected: 1,
};

export function breachOf(rule: string): Breach {
  return { rule, code: rule, message: `${rule} breached`, location: null };
}

export function passResult(inspected: number | null = 1): PassResult {
  return { verdict: 'pass', scan: { ...scan, inspected } };
}

export function failResult(rules: readonly [string, ...string[]], inspected: number | null = 1): FailResult {
  const [first, ...rest] = rules;
  return { verdict: 'fail', scan: { ...scan, inspected }, breaches: [breachOf(first), ...rest.map(breachOf)] };
}

export function refuseResult(code = 'unavailable', inspected: number | null = 1): RefuseResult {
  return { verdict: 'refuse', scan: { ...scan, inspected }, why: { code, message: `${code} refusal`, location: null } };
}

export const everyVerdict: readonly CheckResult[] = [passResult(), failResult(['r1']), refuseResult()];
