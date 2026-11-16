import assert from 'node:assert/strict';
import { chmod, mkdir, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { ruff, type RuffOptions } from '../src/index.ts';
import { atLeast, fakeRuff, ruffBinary, withProject } from './support/workspace.ts';

function run(root: string, options: Partial<RuffOptions> & { rules?: Record<string, string> } = {}) {
  const adapter = ruff({ command: ruffBinary, rules: { unusedImports: 'F401' }, ...options } as RuffOptions);
  return adapter.check.run({ root, rules: Object.values(adapter.rules).map(rule => rule.id) });
}

function fails(result: Awaited<ReturnType<typeof run>>) {
  assert.equal(result.verdict, 'fail', JSON.stringify(result));
  return result.verdict === 'fail' ? result.breaches : [];
}

function refuses(result: Awaited<ReturnType<typeof run>>, code: string): void {
  assert.equal(result.verdict, 'refuse', JSON.stringify(result));
  if (result.verdict === 'refuse') assert.equal(result.why.code, code, JSON.stringify(result.why));
}

test('notebooks: findings keep their cell, because lines restart in every cell', async () => {
  await withProject(['B018.ipynb'], async root => {
    if (!atLeast(0, 6)) {
      // Before 0.6 Ruff does not lint notebooks by default, so the honest answer is a refusal.
      refuses(await run(root, { rules: { b: 'B018' }, isolated: true }), 'ruff-nothing-inspected');
      return;
    }
    const breaches = fails(await run(root, { rules: { b: 'B018' }, isolated: true }));
    assert.equal(breaches.length, 3);
    assert.ok(breaches.every(b => b.location?.file === 'B018.ipynb'));
    assert.deepEqual(breaches.map(b => /cell (\d+)/u.exec(b.detail ?? '')?.[1]), ['3', '4', '6']);
  });
});

test('stub files (.pyi) are inspected like sources', async () => {
  await withProject(['PYI001.pyi'], async root => {
    const breaches = fails(await run(root, { rules: { r: 'PYI001' }, isolated: true }));
    assert.ok(breaches.every(b => b.location?.file === 'PYI001.pyi' && b.rule === 'ruff/PYI001'));
  });
});

test('configFile and cwd select the project settings: target-version decides whether syntax is an error', async () => {
  await withProject([], async root => {
    await mkdir(join(root, 'app'));
    await writeFile(join(root, 'app', 'm.py'), 'import os\nmatch 1:\n    case 1:\n        pass\n');
    await writeFile(join(root, 'old.toml'), 'target-version = "py38"\n');
    await writeFile(join(root, 'new.toml'), 'target-version = "py312"\n');
    // Ruff reports version-gated syntax (`match` on py38) as an error only from 0.14; older Ruff parses it.
    const gated = atLeast(0, 14);
    const old = await run(root, { cwd: 'app', paths: ['m.py'], configFile: 'old.toml' });
    if (gated) refuses(old, 'ruff-syntax-error'); else assert.equal(old.verdict, 'fail');
    const breaches = fails(await run(root, { cwd: 'app', paths: ['m.py'], configFile: 'new.toml' }));
    assert.equal(breaches[0]?.location?.file, 'app/m.py');
    await writeFile(join(root, 'app', 'pyproject.toml'), '[tool.ruff]\ntarget-version = "py38"\n');
    const discovered = await run(root, { cwd: 'app', paths: ['.'] });
    if (gated) refuses(discovered, 'ruff-syntax-error'); else assert.equal(discovered.verdict, 'fail');
  });
});

test('exclusions: a config that excludes everything REFUSES; a partial exclude shrinks the inspected count', async () => {
  await withProject(['F401_single.py', 'F401_5.py'], async root => {
    await writeFile(join(root, 'ruff.toml'), 'extend-exclude = ["F401_5.py"]\n');
    const some = await run(root, { paths: ['.'] });
    assert.equal(some.scan.inspected, 1, 'ruff.toml is listed by Ruff but is not code under check');
    assert.equal(fails(some).length, 1);
    await writeFile(join(root, 'ruff.toml'), 'extend-exclude = ["*.py"]\n');
    refuses(await run(root, { paths: ['.'] }), 'ruff-nothing-inspected');
  });
});

test('file-level `# ruff: noqa` suppresses like noqa, and ignoreNoqa reveals it', async () => {
  await withProject([], async root => {
    await writeFile(join(root, 'f.py'), '# ruff: noqa: F401\nimport os\n');
    assert.equal((await run(root)).verdict, 'pass');
    assert.equal(fails(await run(root, { ignoreNoqa: true })).length, 1);
  });
});

test('awkward paths: spaces, unicode, a leading dash, CRLF and a BOM', async () => {
  await withProject([], async root => {
    await mkdir(join(root, 'dir with space', 'ünï'), { recursive: true });
    await writeFile(join(root, 'dir with space', 'ünï', 'файл.py'), 'import os\r\n');
    await writeFile(join(root, '-dash.py'), '﻿import sys\n');
    const breaches = fails(await run(root, { paths: ['dir with space', './-dash.py'] }));
    assert.deepEqual(breaches.map(b => b.location?.file).sort(), ['-dash.py', 'dir with space/ünï/файл.py']);
    assert.ok(breaches.every(b => b.location?.line === 1));
  });
});

test('symlinks: one inside the root is followed; one leaving the root REFUSES', async () => {
  await withProject(['F401_single.py'], async root => {
    await symlink(join(root, 'F401_single.py'), join(root, 'inside.py'));
    await symlink('/etc', join(root, 'outside'));
    assert.equal(fails(await run(root, { paths: ['inside.py'] })).length, 1);
    refuses(await run(root, { paths: ['outside'] }), 'ruff-path-outside-root');
  });
});

test('an unreadable directory holding a violation REFUSES instead of passing', async () => {
  await withProject([], async root => {
    await mkdir(join(root, 'locked'));
    await writeFile(join(root, 'ok.py'), 'x = 1\n');
    await writeFile(join(root, 'locked', 'bad.py'), 'import os\n');
    await chmod(join(root, 'locked'), 0o000);
    try {
      // A superuser can read any directory, so there nothing is skipped and the violation is simply found.
      if (process.getuid?.() === 0) assert.equal((await run(root)).verdict, 'fail');
      else refuses(await run(root), 'ruff-input-skipped');
    } finally {
      await chmod(join(root, 'locked'), 0o755);
    }
  });
});

test('limits: a timeout and an output cap REFUSE instead of judging partial output', async () => {
  await withProject(['F401_0.py'], async root => {
    refuses(await run(root, { maxOutputBytes: 500 }), 'command-output-limit');
    const slow = join(root, 'slow-ruff.mjs');
    await writeFile(slow, '#!/usr/bin/env node\nsetTimeout(() => {}, 30000);\n');
    await import('node:fs/promises').then(fs => fs.chmod(slow, 0o755));
    refuses(await run(root, { command: slow, timeoutMs: 300 }), 'command-timeout');
  });
});

test('a check leaves no cache and no edits behind, and parallel checks agree', async () => {
  await withProject(['F401_0.py'], async root => {
    const results = await Promise.all(Array.from({ length: 8 }, () => run(root)));
    assert.ok(results.every(r => r.verdict === 'fail' && r.verdict === results[0]?.verdict));
    assert.deepEqual((await readdir(root)).sort(), ['F401_0.py']);
  });
});

test('a fake Ruff that emits notebooks and unknown extra fields still parses', async () => {
  await withProject([], async root => {
    const body = JSON.stringify([{ code: 'F401', message: 'm', filename: join(root, 'a.py'), location: { row: 3, column: 2 }, cell: 2, future_field: { x: 1 } }]);
    const breaches = fails(await run(root, { command: await fakeRuff(root, body, 1) }));
    assert.match(breaches[0]?.detail ?? '', /cell 2/u);
  });
});
