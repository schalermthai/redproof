import type { TestCase, TestReportFormat, TestRun } from '../model.ts';

function decodeXml(value: string): string {
  return value
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (reference, hex, decimal) => {
      const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
      return codePoint <= 0x10FFFF && !(codePoint >= 0xD800 && codePoint <= 0xDFFF)
        ? String.fromCodePoint(codePoint)
        : reference;
    })
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&');
}

function attributes(raw: string): Readonly<Record<string, string>> {
  const attrs: Record<string, string> = {};
  const re = /([:\w.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  for (let match = re.exec(raw); match; match = re.exec(raw)) {
    attrs[match[1]!] = decodeXml(match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function element(body: string, name: string): { attrs: Readonly<Record<string, string>>; text: string } | null {
  const paired = new RegExp(`<${name}\\b([^>]*)>([\\s\\S]*?)<\\/${name}>`, 'i').exec(body);
  if (paired) {
    return { attrs: attributes(paired[1] ?? ''), text: decodeXml((paired[2] ?? '').trim()) };
  }

  const selfClosing = new RegExp(`<${name}\\b([^>]*)\\/>`, 'i').exec(body);
  if (selfClosing) {
    return { attrs: attributes(selfClosing[1] ?? ''), text: '' };
  }

  return null;
}

export function parseJunitXml(input: string): TestRun {
  const tests: TestCase[] = [];
  const testcase = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/gi;

  for (let match = testcase.exec(input); match; match = testcase.exec(input)) {
    const attrs = attributes(match[1] ?? '');
    const body = match[2] ?? '';
    const failure = element(body, 'failure') ?? element(body, 'error');
    const skipped = element(body, 'skipped');
    const status = failure ? 'failed' : skipped ? 'skipped' : 'passed';
    const file = attrs.file ?? null;
    const line = attrs.line ? Number.parseInt(attrs.line, 10) : null;
    const durationSeconds = attrs.time ? Number.parseFloat(attrs.time) : Number.NaN;
    const suite = attrs.classname ? [attrs.classname] : [];

    tests.push({
      name: attrs.name ?? '<unnamed test>',
      suite,
      file,
      status,
      location: file ? { file, line: Number.isFinite(line) ? line : null, column: null } : null,
      ...(Number.isFinite(durationSeconds) ? { durationMs: durationSeconds * 1000 } : {}),
      ...(failure
        ? {
            failure: {
              message: failure.attrs.message ?? (failure.text || 'Test failed.'),
              ...(failure.text ? { detail: failure.text } : {}),
            },
          }
        : {}),
    });
  }

  if (tests.length === 0 && /<testcase\b/i.test(input)) {
    throw new Error('JUnit XML report contains testcase elements that could not be parsed.');
  }

  if (!/<testsuites?\b/i.test(input)) {
    throw new Error('JUnit XML report is missing testsuite/testsuites root content.');
  }

  return { tests };
}

export function junitXml(): TestReportFormat {
  return {
    kind: 'junit-xml',
    extension: '.xml',
    capabilities: { todo: false, flaky: false },
    parse: parseJunitXml,
  };
}
