import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import type { CheckResult } from '../domain/check.ts';
import type { Diagnostic } from '../domain/diagnostic.ts';
import type { Rule } from '../domain/rule.ts';
import type { GateDescription } from '../project/core/description.ts';
import { buildGateReportModel, summarizeGateReports, type RunSummary } from './model.ts';
import type { ProofOutcome } from '../proof/core/outcome.ts';
import type { CheckProjectRun, GateRun } from '../run/shell/project-runner.ts';

const glyph = {
  pass: '✓',
  fail: '❯',
  breach: '×',
  refuse: '!',
  unknown: '?',
} as const;

export type ReportOptions = {
  readonly color?: boolean;
  /** Force expansion of successful Rules. By default a single Gate is expanded. */
  readonly verbose?: boolean;
  readonly sourceContext?: number;
};

function ansi(enabled: boolean, code: number, text: string): string {
  return enabled ? `\u001b[${code}m${text}\u001b[0m` : text;
}

function green(enabled: boolean, text: string) { return ansi(enabled, 32, text); }
function red(enabled: boolean, text: string) { return ansi(enabled, 31, text); }
function yellow(enabled: boolean, text: string) { return ansi(enabled, 33, text); }
function dim(enabled: boolean, text: string) { return ansi(enabled, 2, text); }
function bold(enabled: boolean, text: string) { return ansi(enabled, 1, text); }

function ms(value: number): string {
  if (value < 1) return '<1ms';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function time(date: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function ruleName(rule: Rule): string {
  const slash = rule.id.lastIndexOf('/');
  return slash >= 0 ? rule.id.slice(slash + 1) : rule.id;
}

function fileOf(run: GateRun, root: string): string {
  return relative(root, run.module.file).replaceAll('\\', '/');
}

function gateStatusSuffix(run: GateRun): string {
  const model = buildGateReportModel(run.module.gate.adapter, run.result);
  const ruleCount = model.rules.length;
  const label = `${ruleCount} ${ruleCount === 1 ? 'rule' : 'rules'}`;

  if (model.verdict === 'pass') return `(${label})`;
  if (model.verdict === 'refuse') return `(${label} | refused)`;
  if (model.counting.kind === 'unsupported') return `(${label} | breach detected)`;

  return `(${label} | ${model.breachedRules} breached | ${model.breachCount} ${model.breachCount === 1 ? 'breach' : 'breaches'})`;
}

function renderGateLine(run: GateRun, root: string, color: boolean): string {
  const file = fileOf(run, root);
  const suffix = gateStatusSuffix(run);
  if (run.result.verdict === 'pass') {
    return ` ${green(color, glyph.pass)} ${file} ${dim(color, suffix)} ${dim(color, ms(run.durationMs))}`;
  }
  if (run.result.verdict === 'refuse') {
    return ` ${yellow(color, glyph.refuse)} ${file} ${yellow(color, suffix)} ${dim(color, ms(run.durationMs))}`;
  }
  return ` ${red(color, glyph.fail)} ${file} ${red(color, suffix)} ${dim(color, ms(run.durationMs))}`;
}

function renderRuleTree(run: GateRun, color: boolean): string[] {
  const model = buildGateReportModel(run.module.gate.adapter, run.result);
  if (model.verdict === 'refuse') return [];

  return model.rules.map(item => {
    const name = ruleName(item.rule);
    if (item.state.kind === 'held') return `   ${green(color, glyph.pass)} ${name}`;
    if (item.state.kind === 'unknown') return `   ${yellow(color, glyph.unknown)} ${name} ${dim(color, '(not established)')}`;
    if (item.state.kind === 'undecided') return '';

    const suffix = item.state.count == null
      ? 'breach detected'
      : `${item.state.count} ${item.state.count === 1 ? 'breach' : 'breaches'}`;
    return `   ${red(color, glyph.fail)} ${name}\n     ${red(color, glyph.breach)} ${suffix}`;
  }).filter(Boolean);
}

async function sourceExcerpt(root: string, diagnostic: Diagnostic, context: number, color: boolean, tone: 'fail' | 'refuse'): Promise<string[]> {
  const location = diagnostic.location;
  if (!location) return [];

  const display = location.line == null
    ? location.file
    : `${location.file}:${location.line}${location.column == null ? '' : `:${location.column}`}`;
  const marker = tone === 'refuse' ? yellow(color, glyph.fail) : red(color, glyph.fail);
  const lines = [` ${marker} ${display}`];

  if (location.line == null) return lines;

  try {
    const text = await readFile(resolve(root, location.file), 'utf8');
    const source = text.split(/\r?\n/);
    const target = location.line - 1;
    const start = Math.max(0, target - context);
    const end = Math.min(source.length - 1, target + context);
    const width = String(end + 1).length;

    lines.push('');
    for (let index = start; index <= end; index++) {
      const lineNo = String(index + 1).padStart(width);
      lines.push(`     ${lineNo}| ${source[index] ?? ''}`);
      if (index === target && location.column != null) {
        const caretPad = ' '.repeat(Math.max(0, location.column - 1));
        lines.push(`     ${' '.repeat(width)}| ${caretPad}${red(color, '^')}`);
      }
    }
  } catch {
    // A reporter must not turn a valid CheckResult into a reporting failure.
  }

  return lines;
}

async function renderDiagnostic(root: string, diagnostic: Diagnostic, options: Required<ReportOptions>, tone: 'fail' | 'refuse' = 'fail'): Promise<string[]> {
  const lines: string[] = [];
  lines.push(...await sourceExcerpt(root, diagnostic, options.sourceContext, options.color, tone));
  if (lines.length > 0) lines.push('');
  lines.push(`   ${diagnostic.message}`);

  if (diagnostic.comparison) {
    lines.push('', `   ${red(options.color, 'Expected:')} ${diagnostic.comparison.expected}`);
    lines.push(`   ${green(options.color, 'Received:')} ${diagnostic.comparison.actual}`);
  }
  if (diagnostic.detail) lines.push('', `   ${diagnostic.detail}`);
  if (diagnostic.hint) lines.push('', `   ${dim(options.color, `Hint: ${diagnostic.hint}`)}`);
  return lines;
}

async function renderFailureDetails(run: GateRun, projectRoot: string, options: Required<ReportOptions>): Promise<string[]> {
  if (run.result.verdict !== 'fail') return [];
  const model = buildGateReportModel(run.module.gate.adapter, run.result);
  const file = fileOf(run, projectRoot);
  const sections: string[] = [];

  for (const item of model.rules) {
    if (item.state.kind !== 'breached') continue;
    const name = ruleName(item.rule);
    sections.push('', '', ` ${red(options.color, 'FAIL')}  ${file} > ${name}`, '');
    if (item.state.count != null && item.state.count > 1) sections.push(`${item.state.count} breaches`, '');

    for (let index = 0; index < item.breaches.length; index++) {
      if (index > 0) sections.push('');
      sections.push(...await renderDiagnostic(projectRoot, item.breaches[index]!, options));
    }
  }

  return sections;
}

async function renderRefusalDetails(run: GateRun, projectRoot: string, options: Required<ReportOptions>): Promise<string[]> {
  if (run.result.verdict !== 'refuse') return [];
  const file = fileOf(run, projectRoot);
  return [
    '',
    '',
    ` ${yellow(options.color, 'REFUSE')}  ${file}`,
    '',
    ...await renderDiagnostic(projectRoot, run.result.why, options, 'refuse'),
    '',
    `   ${dim(options.color, 'The Check could not make a trustworthy PASS or FAIL decision.')}`,
  ];
}

function statusParts(summary: RunSummary, color: boolean): string[] {
  const parts: string[] = [];
  if (summary.passedGates) parts.push(green(color, `${summary.passedGates} passed`));
  if (summary.failedGates) parts.push(red(color, `${summary.failedGates} failed`));
  if (summary.refusedGates) parts.push(yellow(color, `${summary.refusedGates} refused`));
  return parts;
}

function ruleParts(summary: RunSummary, color: boolean): string[] {
  const parts: string[] = [];
  if (summary.heldRules) parts.push(green(color, `${summary.heldRules} held`));
  if (summary.breachedRules) {
    const count = summary.exactBreachCount ? String(summary.breachedRules) : `${summary.breachedRules}+`;
    parts.push(red(color, `${count} breached`));
  }
  if (summary.undecidedRules) parts.push(yellow(color, `${summary.undecidedRules} undecided`));
  if (summary.unknownRules) parts.push(yellow(color, `${summary.unknownRules} unknown`));
  return parts;
}

function summaryRows(run: CheckProjectRun, options: Required<ReportOptions>): string[] {
  const summary = summarizeGateReports(run.results.map(item => buildGateReportModel(item.module.gate.adapter, item.result)));
  const gateParts = statusParts(summary, options.color).join(' | ');
  const rules = ruleParts(summary, options.color).join(' | ');
  const rows = [
    ` Gates      ${gateParts} (${run.results.length})`,
    ` Rules      ${rules} (${summary.totalRules})`,
  ];

  if (summary.failedGates) {
    rows.push(` Breaches   ${summary.exactBreachCount ? String(summary.breaches) : 'not countable'}`);
  }
  rows.push(` Start at   ${time(run.startedAt)}`);
  rows.push(` Duration   ${ms(run.durationMs)}`);
  return rows;
}

export async function formatRun(run: CheckProjectRun, options: ReportOptions = {}): Promise<string> {
  const resolved: Required<ReportOptions> = {
    color: options.color ?? false,
    verbose: options.verbose ?? false,
    sourceContext: options.sourceContext ?? 2,
  };
  const lines: string[] = [];
  const expandPass = resolved.verbose || run.results.length === 1;

  for (const item of run.results) {
    lines.push(renderGateLine(item, run.project.root, resolved.color));
    if (item.result.verdict === 'fail' || (item.result.verdict === 'pass' && expandPass)) {
      lines.push(...renderRuleTree(item, resolved.color));
    }
  }

  for (const item of run.results) {
    lines.push(...await renderFailureDetails(item, run.project.root, resolved));
    lines.push(...await renderRefusalDetails(item, run.project.root, resolved));
  }

  lines.push('', '', ...summaryRows(run, resolved));
  return lines.join('\n');
}

/** Kept as a small diagnostic formatter for programmatic users. Prefer formatRun for CLI output. */
export function formatCheck(gate: string, result: CheckResult): string {
  if (result.verdict === 'pass') return `PASS ${gate}`;
  if (result.verdict === 'refuse') return `REFUSE ${gate}\n  ${result.why.code}: ${result.why.message}`;
  return `FAIL ${gate}\n${result.breaches.map(item => `  ${item.rule}: ${item.message}`).join('\n')}`;
}

export function formatProof(outcome: ProofOutcome): string {
  const mark = outcome.ok ? '✓' : '✗';
  if (outcome.status === 'error') {
    const actual = outcome.result ? ` actual=${outcome.result.verdict}` : '';
    return `${mark} ${outcome.gate} / ${outcome.proof} expected=${outcome.expected}${actual} error=${outcome.error.code}\n  ${outcome.error.message}${outcome.error.detail ? `\n  ${outcome.error.detail}` : ''}`;
  }
  return `${mark} ${outcome.gate} / ${outcome.proof} expected=${outcome.expected} actual=${outcome.result.verdict}`;
}

function indentDescription(text: string): string[] {
  return text.split('\n').map(line => `  ${line}`);
}

export function formatGateDescription(description: GateDescription): string {
  const lines: string[] = [`Gate: ${description.gate}`, '', 'Rules:'];

  if (description.rules.length === 0) {
    lines.push('  (none)');
  } else {
    for (const rule of description.rules) lines.push(`  ${rule.label} ${rule.description}`);
  }

  lines.push('', 'Check:', ...indentDescription(description.check));

  for (const item of description.proofs) {
    const label = item.kind === 'red' ? item.targetLabel ?? 'RED' : item.kind.toUpperCase();
    lines.push('', `Proof ${label}:`, `  ${item.name}`);
    if (item.mutation) lines.push(`  mutation: ${item.mutation}`);
    lines.push('  run the same Check');
    lines.push(`  expect Gate ${item.kind === 'red' ? 'FAIL' : item.kind === 'green' ? 'PASS' : 'REFUSE'}`);
  }

  return lines.join('\n');
}
