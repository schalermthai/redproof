import { writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import type { ReporterOptions } from 'knip';

/** Private per-run artifact: configuration logging never becomes report JSON. */
export default function report(data: ReporterOptions): void {
  const target = process.env.REDPROOF_KNIP_REPORT;
  const root = process.env.REDPROOF_KNIP_ROOT;
  if (!target || !root) throw new Error('Missing Redproof Knip report context.');
  const issues = Object.fromEntries(Object.entries(data.issues).map(([type, records]) => [
    type,
    Object.values(records).flatMap(Object.values).map(issue => ({
      type: issue.type,
      file: relative(root, issue.filePath).replaceAll('\\', '/'),
      symbol: issue.symbol,
      symbols: issue.symbols,
      parentSymbol: issue.parentSymbol,
      severity: issue.severity,
      line: issue.line,
      col: issue.col,
    })),
  ]));
  const hintDetails = [
    ...(!data.isDisableConfigHints && data.isTreatConfigHintsAsErrors
      ? data.configurationHints.map(hint => `${hint.type}: ${String(hint.identifier)}`) : []),
    ...(!data.isDisableTagHints && data.isTreatTagHintsAsErrors
      ? [...data.tagHints].map(hint => `${hint.tagName}: ${hint.identifier} (${relative(root, hint.filePath)})`) : []),
  ];
  const output = JSON.stringify({ version: 1, report: data.report, counters: data.counters,
    issues, hasConfigLoadErrors: data.hasConfigLoadErrors,
    hasBlockingHints: hintDetails.length > 0, hintDetails });
  if (Buffer.byteLength(output) > Number(process.env.REDPROOF_KNIP_LIMIT)) {
    throw new Error('Knip evidence exceeds maxOutputBytes.');
  }
  writeFileSync(target, output, { flag: 'wx' });
}
