import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { defineGate, runGate } from 'redproof';
import { tach, type TachRuleKind } from '../src/index.ts';
import { projects, type ProjectName } from './support/projects.ts';
import { hasTach, nativeTest, tachBinary, tachRequired, withFiles, withProject } from './support/workspace.ts';

if (tachRequired && !hasTach) {
  test('the tach the environment names is installed (REDPROOF_TACH_REQUIRED=1 says CI must run the native tests)', () => assert.fail(
    `No tach found at ${tachBinary}. Set REDPROOF_TACH_PYTHON to the python of a virtualenv that has tach.`));
}

// Real tach, through the Gate a user would write, one rule selected alone each time.
const t = nativeTest(test);

async function verdict(root: string, kind: TachRuleKind, extra: object = {}): Promise<readonly string[]> {
  const adapter = tach({ rules: { only: kind }, command: tachBinary, ...extra } as never);
  const result = await runGate(defineGate({ id: `tach-${kind}`, adapter: adapter as never }), root);
  if (result.verdict === 'fail') return ['fail', ...result.breaches.map(b => `${b.rule}:${b.code}@${b.location?.file}:${b.location?.line ?? ''}`)];
  return result.verdict === 'refuse' ? ['refuse', result.why.code] : [result.verdict];
}
const write = async (root: string, file: string, text: string): Promise<void> => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
};
const A = 'src/a/__init__.py';

type Case = { readonly kind: TachRuleKind; readonly project: ProjectName; readonly red: readonly string[]; readonly fix: (root: string) => Promise<void> };
const okToml = projects.ok['tach.toml'];

const CASES: readonly Case[] = [
  { kind: 'undeclared-dependency', project: 'undeclared', red: ['fail', `tach/undeclared-dependency:UndeclaredDependency@${A}:1`], fix: r => write(r, 'tach.toml', okToml) },
  { kind: 'forbidden-dependency', project: 'forbidden', red: ['fail', `tach/forbidden-dependency:ForbiddenDependency@${A}:1`],
    fix: r => write(r, 'tach.toml', projects.forbidden['tach.toml'].replace('cannot_depend_on = ["b"]', 'cannot_depend_on = ["c"]')) },
  { kind: 'deprecated-dependency', project: 'deprecated', red: ['fail', `tach/deprecated-dependency:DeprecatedDependency@${A}:1`],
    fix: async r => {
      await write(r, 'src/c/__init__.py', 'y = 1\n');
      await write(r, 'tach.toml', `${projects.deprecated['tach.toml'].replace('{ path = "b", deprecated = true }', '{ path = "b", deprecated = false }, { path = "c", deprecated = true }')}[[modules]]\npath = "c"\ndepends_on = []\n`);
    } },
  { kind: 'layer-violation', project: 'layer', red: ['fail', `tach/layer-violation:LayerViolation@${A}:1`],
    fix: r => write(r, 'tach.toml', projects.layer['tach.toml'].replace('layer = "low"', 'layer = "X"').replace('layer = "high"', 'layer = "low"').replace('layer = "X"', 'layer = "high"')) },
  { kind: 'layer-violation', project: 'closed-layer', red: ['fail', `tach/layer-violation:ClosedLayerViolation@${A}:1`],
    fix: r => write(r, 'tach.toml', projects['closed-layer']['tach.toml'].replace('closed = true', 'closed = false')) },
  { kind: 'interface-violation', project: 'interface', red: ['fail', `tach/interface-violation:PrivateDependency@${A}:1`], fix: r => write(r, A, 'from b import public_fn\n') },
  { kind: 'interface-violation', project: 'data-type', red: ['fail', `tach/interface-violation:InvalidDataTypeExport@${A}:1`],
    fix: r => write(r, 'src/b/__init__.py', 'def thing(x: int) -> int: ...\n') },
  { kind: 'ignore-directive', project: 'missing-reason', red: ['fail', `tach/ignore-directive:MissingIgnoreDirectiveReason@${A}:1`],
    fix: r => write(r, A, 'from b import thing  # tach-ignore(legacy import, see ticket)\n') },
  { kind: 'ignore-directive', project: 'unnecessary-ignore', red: ['fail', `tach/ignore-directive:UnusedIgnoreDirective@${A}:1`], fix: r => write(r, A, 'from b import thing\n') },
  { kind: 'circular-dependency', project: 'cycle', red: ['fail', 'tach/circular-dependency:CircularDependency@tach.toml:'],
    fix: r => write(r, 'tach.toml', projects.cycle['tach.toml'].replace('depends_on = ["a"]', 'depends_on = []')) },
  { kind: 'visibility-violation', project: 'visibility', red: ['fail', 'tach/visibility-violation:VisibilityError@tach.toml:'],
    fix: r => write(r, 'tach.toml', projects.visibility['tach.toml'].replace('visibility = ["c"]', 'visibility = ["a"]')) },
];

for (const c of CASES) {
  t(`real tach, ${c.kind} alone on ${c.project}: RED naming the finding, fix, GREEN`, () => withProject(c.project, async root => {
    assert.deepEqual(await verdict(root, c.kind), c.red);
    await c.fix(root);
    assert.deepEqual(await verdict(root, c.kind), ['pass']);
  }));
}

t('real tach: a project that only breaks other rules passes the rule that was asked (rules the project switches on)', () => withFiles({
  ...projects.undeclared,
  'tach.toml': `forbid_circular_dependencies = true\nlayers = ["high", "low"]\n${projects.undeclared['tach.toml'].replace('depends_on = []', 'depends_on = []\ncannot_depend_on = ["c"]\nlayer = "high"')}[[interfaces]]\nexpose = [".*"]\nfrom = ["b"]\n`,
}, async root => {
  for (const kind of ['layer-violation', 'interface-violation', 'forbidden-dependency', 'ignore-directive', 'circular-dependency'] as const) {
    assert.deepEqual(await verdict(root, kind), ['pass'], kind);
  }
}));

t('real tach: a cycle stops tach before any other rule runs, so a wider Gate REFUSES instead of passing the rest', () => withProject('cycle', async root => {
  const both = tach({ rules: { a: 'circular-dependency', b: 'layer-violation' }, command: tachBinary, allowInactiveRules: true });
  const result = await runGate(defineGate({ id: 'wide', adapter: both }), root);
  assert.equal(result.verdict, 'refuse');
  if (result.verdict === 'refuse') assert.equal(result.why.code, 'tach-run-aborted');
}));

const REFUSALS: ReadonlyArray<readonly [ProjectName, string]> = [
  ['syntax-error', 'tach-configuration-diagnostic'],
  ['no-python', 'tach-configuration-diagnostic'],
  ['bad-toml', 'tach-config-unreadable'],
];
for (const [project, code] of REFUSALS) {
  t(`real tach: ${project} REFUSES with ${code}, for every rule`, () => withProject(project, async root => {
    for (const kind of ['undeclared-dependency', 'layer-violation', 'interface-violation'] as const) {
      assert.deepEqual(await verdict(root, kind, { allowInactiveRules: true }), ['refuse', code], kind);
    }
  }));
}

t('real tach: a tach.toml above the working directory is never borrowed', () => withProject('undeclared', async root => {
  await write(root, 'sub/placeholder.py', 'x = 1\n');
  assert.deepEqual(await verdict(root, 'undeclared-dependency', { cwd: 'sub' }), ['refuse', 'tach-config-missing']);
}));

t('real tach: cwd moves the project; file paths stay relative to the Gate root', () => withProject('undeclared', async root => {
  for (const [file, text] of Object.entries(projects.undeclared)) await write(root, `pkg/${file}`, text);
  assert.deepEqual(await verdict(root, 'undeclared-dependency', { cwd: 'pkg' }),
    ['fail', 'tach/undeclared-dependency:UndeclaredDependency@pkg/src/a/__init__.py:1']);
}));

t('real tach: a tach.toml that is a symlink to nowhere is refused, not borrowed', () => withProject('ok', async root => {
  await rm(join(root, 'tach.toml'));
  await symlink(join(root, '..', 'definitely-elsewhere.toml'), join(root, 'tach.toml'));
  assert.deepEqual(await verdict(root, 'layer-violation'), ['refuse', 'tach-config-missing']);
}));
