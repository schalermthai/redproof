import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { buildPlugin } from '../scripts/build-plugin.ts';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const skillNames = ['build', 'challenge', 'design', 'discover', 'review-pr'];

async function temporary(t: TestContext): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'redproof-plugin-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function listFiles(root: string): Promise<string[]> {
  const paths: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      assert.equal(entry.isSymbolicLink(), false, path);
      if (entry.isDirectory()) await walk(path);
      else paths.push(relative(root, path).split('\\').join('/'));
    }
  }
  await walk(root);
  return paths.sort();
}

async function fixtureSource(t: TestContext): Promise<string> {
  const root = await temporary(t);
  await cp(join(repository, 'agents/plugin'), join(root, 'agents/plugin'), { recursive: true });
  await cp(join(repository, 'agents/skills'), join(root, 'agents/skills'), { recursive: true });
  await cp(join(repository, 'agents/skill-support'), join(root, 'agents/skill-support'), { recursive: true });
  await cp(join(repository, 'LICENSE'), join(root, 'LICENSE'));
  return root;
}

test('plugin contains exactly the shared skills and their declared resources, with matching host metadata', async t => {
  const root = await temporary(t);
  const bundle = await buildPlugin(join(root, 'redproof'));
  const files = JSON.parse(await readFile(join(repository, 'agents/plugin/files.json'), 'utf8')) as string[];
  const actual = await listFiles(bundle);
  assert.deepEqual(actual, [...files, 'README.md', 'LICENSE', 'plugin.json', '.codex-plugin/plugin.json', '.claude-plugin/plugin.json', 'bundle-files.json'].sort());
  assert.deepEqual((await readdir(join(bundle, 'skills'), { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort(), skillNames);
  for (const file of files) assert.deepEqual(await readFile(join(bundle, file)), await readFile(join(repository, 'agents', file)), file);
  // Catch new required source resources not yet added to the shipping list.
  const sources = [...(await listFiles(join(repository, 'agents/skills'))).map(file => `skills/${file}`),
    ...(await listFiles(join(repository, 'agents/skill-support'))).map(file => `skill-support/${file}`)];
  assert.deepEqual(files.slice().sort(), sources.sort());
  const portable = JSON.parse(await readFile(join(bundle, 'plugin.json'), 'utf8'));
  const codex = JSON.parse(await readFile(join(bundle, '.codex-plugin/plugin.json'), 'utf8'));
  const claude = JSON.parse(await readFile(join(bundle, '.claude-plugin/plugin.json'), 'utf8'));
  const { skills, interface: presentation, ...identity } = codex;
  assert.equal(skills, './skills/');
  assert.deepEqual(claude, identity);
  assert.deepEqual(portable, { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', ...identity, extensions: { 'com.openai': { interface: presentation } } });
  assert.deepEqual(Object.keys(codex).sort(), ['name', 'version', 'description', 'author', 'homepage', 'repository', 'license', 'keywords', 'skills', 'interface'].sort());
});

test('only five public skills are registered; internal routing and UI remain reachable resources', async t => {
  const bundle = await buildPlugin(join(await temporary(t), 'redproof'));
  const paths = await listFiles(bundle);
  assert.deepEqual(paths.filter(file => file.endsWith('/SKILL.md')), skillNames.map(name => `skills/${name}/SKILL.md`));
  assert.deepEqual(paths.filter(file => file.endsWith('/agents/openai.yaml')), skillNames.map(name => `skills/${name}/agents/openai.yaml`));
  for (const name of skillNames) {
    const skill = await readFile(join(bundle, `skills/${name}/SKILL.md`), 'utf8');
    assert.equal(skill.match(/^name: (.+)$/m)?.[1], name);
    const descriptor = await readFile(join(bundle, `skills/${name}/agents/openai.yaml`), 'utf8');
    assert.ok(descriptor.includes(`$${name}`), `Default prompt must invoke ${name}`);
  }
  async function reachable(entry: string, visited = new Set<string>()): Promise<Set<string>> {
    if (visited.has(entry)) return visited;
    visited.add(entry);
    const content = await readFile(join(bundle, entry), 'utf8');
    for (const match of content.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = match[1]!.split('#')[0]!;
      if (!href || /^[a-z]+:/i.test(href)) continue;
      const target = relative(bundle, resolve(bundle, dirname(entry), href)).split('\\').join('/');
      assert.ok(!target.startsWith('..'), `Escaping resource: ${target}`);
      if (target.endsWith('.md')) await reachable(target, visited);
    }
    return visited;
  }
  for (const stage of ['discover', 'design', 'build']) {
    const reached = await reachable(`skills/${stage}/SKILL.md`);
    assert.ok(reached.has('skill-support/routing.md'), `${stage} lost routing`);
    assert.ok(reached.has('skill-support/review-ui/guide.md'), `${stage} lost its review UI`);
  }
  // A renamed handoff must still identify a real public skill, never an internal command.
  for (const path of [...skillNames.map(name => `skills/${name}/SKILL.md`), 'skill-support/routing.md', 'skill-support/runtime.md']) {
    const content = await readFile(join(bundle, path), 'utf8');
    for (const match of content.matchAll(/`\$([a-z][a-z-]*)`/g)) {
      assert.ok(skillNames.includes(match[1]!), `${path}: unresolved skill ${match[1]}`);
    }
  }
});

test('bundled Markdown resource links stay inside the bundle and resolve', async t => {
  const bundle = await buildPlugin(join(await temporary(t), 'redproof'));
  for (const file of (await listFiles(bundle)).filter(file => file.endsWith('.md'))) {
    const content = await readFile(join(bundle, file), 'utf8');
    assert.doesNotMatch(content, /\/(?:Users|home)\/[a-z][^\s]*/i, `Personal path in ${file}`);
    for (const match of content.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = match[1]!;
      if (/^(?:https?:|#)/.test(href)) continue;
      const path = resolve(dirname(join(bundle, file)), href.split('#')[0]!);
      const rel = relative(bundle, path);
      assert.ok(rel && !rel.startsWith('..'), `${file}: escaping link ${href}`);
      assert.ok((await lstat(path)).isFile(), `${file}: missing link ${href}`);
    }
  }
});

test('two independent bundles have identical bytes and complete deterministic hashes', async t => {
  const a = await buildPlugin(join(await temporary(t), 'redproof'));
  const b = await buildPlugin(join(await temporary(t), 'redproof'));
  const inventory = JSON.parse(await readFile(join(a, 'bundle-files.json'), 'utf8'));
  const paths = await listFiles(a);
  assert.deepEqual(Object.keys(inventory.files).sort(), paths.filter(p => p !== 'bundle-files.json'));
  for (const file of paths) {
    const bytes = await readFile(join(a, file));
    assert.deepEqual(bytes, await readFile(join(b, file)), file);
    if (file !== 'bundle-files.json') assert.equal(createHash('sha256').update(bytes).digest('hex'), inventory.files[file], file);
  }
});

test('undeclared reports and dependency files cannot enter a bundle', async t => {
  const source = await fixtureSource(t);
  await writeFile(join(source, 'agents/skills/private-report.json'), '{"private":true}');
  await mkdir(join(source, 'agents/skills/node_modules'));
  await writeFile(join(source, 'agents/skills/node_modules/secret.txt'), 'never ship');
  const bundle = await buildPlugin(join(await temporary(t), 'redproof'), source);
  assert.ok(!(await listFiles(bundle)).some(file => file.includes('private-report') || file.includes('node_modules')));
});

test('missing resources, links and escaping source paths fail before output exists', async t => {
  const source = await fixtureSource(t);
  const output = join(await temporary(t), 'redproof');
  const resource = join(source, 'agents/skills/challenge/verdicts.md');
  await rm(resource);
  await assert.rejects(buildPlugin(output, source), /ENOENT/);
  await assert.rejects(lstat(output), /ENOENT/);
  await symlink(join(repository, 'agents/skills/challenge/verdicts.md'), resource);
  await assert.rejects(buildPlugin(output, source), /not links/);
  await assert.rejects(lstat(output), /ENOENT/);
  // Even an allowlist edit cannot read outside the selected source tree.
  await writeFile(join(source, 'agents/plugin/files.json'), JSON.stringify(['skills/../../secret.txt']));
  await assert.rejects(buildPlugin(output, source), /Invalid plugin source path/);
  await writeFile(join(source, 'agents/plugin/files.json'), JSON.stringify(['skills/../secret.txt']));
  await assert.rejects(buildPlugin(output, source), /Invalid plugin source path/);
  await writeFile(join(source, 'agents/plugin/files.json'), JSON.stringify(['skill-support/../../secret.txt']));
  await assert.rejects(buildPlugin(output, source), /Invalid plugin source path/);
});

test('existing destinations, output symlinks and misleading names are refused without overwriting', async t => {
  const root = await temporary(t);
  const output = join(root, 'redproof');
  await mkdir(output);
  await writeFile(join(output, 'keep.txt'), 'user content');
  await assert.rejects(buildPlugin(output), /EEXIST/);
  assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'user content');
  const linkRoot = await temporary(t);
  await symlink(output, join(linkRoot, 'redproof'));
  await assert.rejects(buildPlugin(join(linkRoot, 'redproof')), /EEXIST/);
  await assert.rejects(buildPlugin(join(root, 'other-name')), /must be named redproof/);
  assert.deepEqual(await readdir(output), ['keep.txt']);
});

test('builder CLI rejects malformed options', () => {
  for (const args of [['--out'], ['--unknown'], ['--out', '--help'], ['--out', 'one', '--out', 'two']]) {
    const result = spawnSync(process.execPath, [join(repository, 'agents/scripts/build-plugin.ts'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
});

test('relocated builder resolves repository sources from an unrelated working directory', async t => {
  const output = join(await temporary(t), 'redproof');
  const result = spawnSync(process.execPath, [join(repository, 'agents/scripts/build-plugin.ts'), '--out', output], {
    cwd: await temporary(t), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(await readFile(join(output, 'LICENSE')), await readFile(join(repository, 'LICENSE')));
  assert.deepEqual(await readFile(join(output, 'skills/discover/SKILL.md')),
    await readFile(join(repository, 'agents/skills/discover/SKILL.md')));
  assert.ok(!(await listFiles(output)).some(file => file.startsWith('agents/')));
});

test('standalone bundle runs the review helper self-tests from an unrelated working directory', { timeout: 60_000 }, async t => {
  const bundle = await buildPlugin(join(await temporary(t), 'redproof'));
  const cwd = await temporary(t);
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // Child must run its own suite, not inherit our worker context.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap', join(bundle, 'skill-support/review-ui/scripts/review.test.mjs')], {
    cwd, env, encoding: 'utf8', timeout: 55_000,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /(?:#|ℹ) pass 14\b/);
});
