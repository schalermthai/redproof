import type { Diagnostic } from '../../domain/diagnostic.ts';
import type { CheckProjectRun } from '../../run/core/run.ts';
import { buildJsonCheckReport } from './check-report.ts';

export type SarifReporterOptions = {
  readonly pretty?: boolean;
};

type SarifLocation = {
  readonly physicalLocation: {
    readonly artifactLocation: { readonly uri: string };
    readonly region?: {
      readonly startLine?: number;
      readonly startColumn?: number;
    };
  };
};

function sarifLocation(diagnostic: Pick<Diagnostic, 'location'>): readonly SarifLocation[] | undefined {
  const location = diagnostic.location;
  if (!location) return undefined;

  const region = location.line == null
    ? undefined
    : {
        startLine: location.line,
        ...(location.column == null ? {} : { startColumn: location.column }),
      };

  return [{
    physicalLocation: {
      artifactLocation: { uri: location.file.replaceAll('\\', '/') },
      ...(region ? { region } : {}),
    },
  }];
}

export function buildSarif(run: CheckProjectRun): object {
  const report = buildJsonCheckReport(run);
  const rules = new Map<string, { id: string; description: string }>();
  const results: object[] = [];
  const notifications: object[] = [];

  for (const gate of report.gates) {
    for (const rule of gate.rules) {
      rules.set(rule.id, { id: rule.id, description: rule.description });
      for (const breach of rule.breaches) {
        const locations = sarifLocation(breach);
        results.push({
          ruleId: rule.id,
          level: 'error',
          message: { text: breach.message },
          ...(locations ? { locations } : {}),
          properties: {
            gateId: gate.id,
            diagnosticCode: breach.code,
            ...(breach.comparison ? { comparison: breach.comparison } : {}),
            ...(breach.detail ? { detail: breach.detail } : {}),
            ...(breach.hint ? { hint: breach.hint } : {}),
          },
        });
      }
    }

    if (gate.refusal) {
      const locations = sarifLocation(gate.refusal);
      notifications.push({
        level: 'error',
        message: { text: `${gate.id}: ${gate.refusal.message}` },
        ...(locations ? { locations } : {}),
        properties: {
          gateId: gate.id,
          diagnosticCode: gate.refusal.code,
          ...(gate.refusal.detail ? { detail: gate.refusal.detail } : {}),
          ...(gate.refusal.hint ? { hint: gate.refusal.hint } : {}),
        },
      });
    }
  }

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: {
        driver: {
          name: 'redproof',
          rules: [...rules.values()].map(rule => ({
            id: rule.id,
            shortDescription: { text: rule.description },
          })),
        },
      },
      results,
      invocations: [{
        executionSuccessful: report.summary.gates.refused === 0,
        ...(notifications.length > 0 ? { toolExecutionNotifications: notifications } : {}),
      }],
    }],
  };
}

export function formatSarifRun(run: CheckProjectRun, options: SarifReporterOptions = {}): string {
  return JSON.stringify(buildSarif(run), null, options.pretty === false ? undefined : 2);
}
