import assert from 'node:assert/strict';
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test, { type TestContext } from 'node:test';
import { assertReleaseReadiness, buildPluginRelease, compareVersions, hostChecks, releaseVersion } from '../scripts/plugin-release.ts';
import { publishPluginRelease, validatePluginRelease } from '../scripts/publish-plugin.ts';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const pluginWorkflow = 'publish-harness-plugins.yml';
const sourceCommit = 'a'.repeat(40);

async function temporary(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'redproof-release-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function readiness(version: string, hash: string) {
  return { version, bundleSha256: hash, hosts: Object.fromEntries(['codex', 'claude'].map(host => [host, {
    version: 'test-fixture-only', evidence: 'Synthetic test evidence, never a real compatibility claim',
    checks: Object.fromEntries(hostChecks.map(check => [check, 'pass'])),
  }])) };
}

async function source(t: TestContext, version = '0.1.0') {
  const root = await temporary(t);
  for (const path of ['agents/plugin', 'agents/skills', 'agents/skill-support', 'LICENSE']) await cp(join(repository, path), join(root, path), { recursive: true });
  const manifestPath = join(root, 'agents/plugin/redproof/.codex-plugin/plugin.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = version;
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(root, 'agents/plugin/CHANGELOG.md'), `# Test release\n\n## ${version}\n\nSynthetic release only.\n`);
  return root;
}

async function fixture(t: TestContext, version = '0.1.0') {
  const result = await buildPluginRelease({ tag: `plugin-v${version}`, sourceCommit,
    destination: join(await temporary(t), 'marketplace'), sourceRoot: await source(t, version) });
  await writeFile(join(result.output, 'release-readiness.json'), JSON.stringify(readiness(version, result.bundleSha256)));
  return result;
}

test('plugin tags and numeric versions cannot be confused with library tags or shell input', () => {
  assert.equal(releaseVersion('plugin-v0.1.0'), '0.1.0');
  for (const bad of ['v0.1.0', 'plugin-v01.2.3', 'plugin-v0.1.0\n', 'plugin-v0.1.0-rc.1', 'plugin-v1.0.0;echo oops', '../main']) {
    assert.throws(() => releaseVersion(bad));
  }
  assert.equal(compareVersions('0.10.0', '0.9.9'), 1);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  assert.equal(compareVersions('0.2.9', '0.3.0'), -1);
});

test('both marketplace catalogs point to the complete bundle in a versioned standalone snapshot', async t => {
  const result = await fixture(t);
  const { files, metadata } = await validatePluginRelease(result.output);
  assert.equal(metadata.bundleTag, 'plugin-bundle-v0.1.0');
  assert.equal(metadata.sourceCommit, sourceCommit);
  const codex = JSON.parse(files.get('.agents/plugins/marketplace.json')!.toString());
  const claude = JSON.parse(files.get('.claude-plugin/marketplace.json')!.toString());
  assert.equal(codex.name, 'redproof-plugins');
  assert.equal(claude.name, codex.name);
  assert.equal(codex.plugins[0].source.path, './plugins/redproof');
  assert.equal(claude.plugins[0].source, './plugins/redproof');
  for (const name of ['discover', 'design', 'build', 'challenge', 'review-pr']) {
    assert.ok(files.has(`plugins/redproof/skills/${name}/SKILL.md`));
  }
  assert.ok(files.has('plugins/redproof/skill-support/review-ui/scripts/review.mjs'));
});

test('release builder refuses tag mismatch, invalid commits and existing output without overwriting', async t => {
  const root = await temporary(t);
  const sourceRoot = await source(t);
  const output = join(root, 'marketplace');
  await assert.rejects(buildPluginRelease({ tag: 'plugin-v9.0.0', sourceCommit, destination: output, sourceRoot }), /disagrees/);
  await assert.rejects(buildPluginRelease({ tag: 'plugin-v0.1.0', sourceCommit: 'main', destination: output, sourceRoot }), /full source Git commit/);
  await mkdir(output);
  await writeFile(join(output, 'keep.txt'), 'keep');
  await assert.rejects(buildPluginRelease({ tag: 'plugin-v0.1.0', sourceCommit, destination: output, sourceRoot }), /EEXIST/);
  assert.equal(await readFile(join(output, 'keep.txt'), 'utf8'), 'keep');
});

test('publishing requires every host check and exact-bundle readiness, not just a version number', () => {
  assertReleaseReadiness(readiness('0.1.0', 'hash'), '0.1.0', 'hash');
  for (const host of ['codex', 'claude']) {
    for (const check of hostChecks) {
      const record = readiness('0.1.0', 'hash');
      record.hosts[host]!.checks[check] = 'pending';
      assert.throws(() => assertReleaseReadiness(record, '0.1.0', 'hash'), new RegExp(`${host}: ${check}`));
    }
  }
  assert.throws(() => assertReleaseReadiness(null, '0.1.0', 'hash'), /not ready/);
  assert.throws(() => assertReleaseReadiness(readiness('0.1.0', 'old-hash'), '0.1.0', 'hash'), /exact plugin bundle/);
  assert.throws(() => assertReleaseReadiness(readiness('0.1.0', 'hash'), '0.2.0', 'hash'), /version/);
});

test('changed bundle files, catalogs, extra files and symlinks fail release verification', async t => {
  const result = await fixture(t);
  const skill = join(result.output, 'plugins/redproof/skills/discover/SKILL.md');
  const original = await readFile(skill);
  await writeFile(skill, 'changed after host evaluation');
  await assert.rejects(validatePluginRelease(result.output), /hash mismatch/);
  await writeFile(skill, original);
  const catalog = join(result.output, '.agents/plugins/marketplace.json');
  const catalogBytes = await readFile(catalog);
  await writeFile(catalog, '{}');
  await assert.rejects(validatePluginRelease(result.output), /Unexpected marketplace/);
  await writeFile(catalog, catalogBytes);
  await writeFile(join(result.output, 'secret.txt'), 'do not publish');
  await assert.rejects(validatePluginRelease(result.output), /unexpected files/);
  await rm(join(result.output, 'secret.txt'));
  await symlink(skill, join(result.output, 'link'));
  await assert.rejects(validatePluginRelease(result.output), /symlink/);
});

test('local Git publication is atomic, retryable and refuses reused or decreasing versions', { timeout: 60_000 }, async t => {
  const remote = join(await temporary(t), 'remote.git');
  execFileSync('git', ['init', '--bare', '--quiet', remote]);
  const git = (...args: string[]) => execFileSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8' }).trim();
  const first = await fixture(t, '0.1.0');
  assert.equal((await publishPluginRelease(first.output, remote)).status, 'published');
  const initialCommit = git('rev-parse', 'refs/heads/plugin-marketplace');
  assert.equal(git('rev-parse', 'refs/tags/plugin-bundle-v0.1.0'), initialCommit);
  assert.equal((await publishPluginRelease(first.output, remote)).status, 'already-published');
  assert.equal(git('rev-parse', 'refs/heads/plugin-marketplace'), initialCommit);

  const next = await fixture(t, '0.2.0');
  assert.equal((await publishPluginRelease(next.output, remote)).status, 'published');
  const nextCommit = git('rev-parse', 'refs/heads/plugin-marketplace');
  assert.equal(git('rev-parse', `${nextCommit}^`), initialCommit);
  assert.equal(git('rev-parse', 'refs/tags/plugin-bundle-v0.1.0'), initialCommit);
  await publishPluginRelease(first.output, remote);
  assert.equal(git('rev-parse', 'refs/heads/plugin-marketplace'), nextCommit, 'Old retries must not roll users back');

  await writeFile(join(first.output, 'README.md'), 'attempt to change released bytes');
  await assert.rejects(publishPluginRelease(first.output, remote), /overwrite immutable/);
  const older = await fixture(t, '0.1.1');
  await assert.rejects(publishPluginRelease(older.output, remote), /non-increasing/);
  assert.equal(git('rev-parse', 'refs/heads/plugin-marketplace'), nextCommit);
  assert.deepEqual(git('for-each-ref', '--format=%(refname)', 'refs/heads').split('\n'), ['refs/heads/plugin-marketplace']);
});

test('a missing bundle tag cannot permit an equal-version republish', { timeout: 60_000 }, async t => {
  const remote = join(await temporary(t), 'remote.git');
  execFileSync('git', ['init', '--bare', '--quiet', remote]);
  const git = (...args: string[]) => execFileSync('git', ['--git-dir', remote, ...args], { encoding: 'utf8' }).trim();
  const candidate = await fixture(t, '0.1.0');
  assert.equal((await publishPluginRelease(candidate.output, remote)).status, 'published');
  const initialCommit = git('rev-parse', 'refs/heads/plugin-marketplace');

  // Simulate manual tag deletion in this disposable remote, not a normal retry.
  git('update-ref', '-d', 'refs/tags/plugin-bundle-v0.1.0');
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/tags'), '');
  await writeFile(join(candidate.output, 'README.md'), 'different content under the same released version');
  await validatePluginRelease(candidate.output);

  await assert.rejects(publishPluginRelease(candidate.output, remote), /non-increasing/);
  assert.equal(git('rev-parse', 'refs/heads/plugin-marketplace'), initialCommit, 'Refusal must not advance the marketplace');
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/tags'), '', 'Refusal must not recreate the deleted tag');
});

test('a server refusing a tag cannot advance the marketplace branch', { timeout: 60_000 }, async t => {
  const remote = join(await temporary(t), 'remote.git');
  execFileSync('git', ['init', '--bare', '--quiet', remote]);
  await writeFile(join(remote, 'hooks/update'), '#!/bin/sh\ncase "$1" in refs/tags/*) exit 1;; esac\nexit 0\n', { mode: 0o755 });
  const candidate = await fixture(t);
  await assert.rejects(publishPluginRelease(candidate.output, remote));
  assert.equal(execFileSync('git', ['--git-dir', remote, 'for-each-ref'], { encoding: 'utf8' }).trim(), '');
});

test('unapproved host checks refuse publication before contacting even a local remote', async t => {
  const result = await fixture(t);
  await writeFile(join(result.output, 'release-readiness.json'), '{}');
  await assert.rejects(publishPluginRelease(result.output, '/nonexistent-remote'), /Plugin release is not ready/);
});

test('exactly one workflow invokes the plugin publisher and the release guide names it', async () => {
  const directory = join(repository, '.github/workflows');
  const publishers: string[] = [];
  for (const filename of await readdir(directory)) {
    if (!/\.ya?ml$/.test(filename)) continue;
    const workflow = await readFile(join(directory, filename), 'utf8');
    if (/node (?:"\$PLUGIN_PUBLISHER"|(?:agents\/)?scripts\/publish-plugin\.ts)[^\n]*--publish\b/.test(workflow)) publishers.push(filename);
  }
  assert.deepEqual(publishers.sort(), [pluginWorkflow]);
  const guide = await readFile(join(repository, 'agents/plugin/RELEASING.md'), 'utf8');
  assert.ok(guide.includes(`gh workflow run ${pluginWorkflow} --ref main`));
});

test('release workflows keep npm and plugin publication separate and preserve hidden catalogs', async () => {
  const npm = await readFile(join(repository, '.github/workflows/publish.yml'), 'utf8');
  const plugin = await readFile(join(repository, '.github/workflows', pluginWorkflow), 'utf8');
  assert.match(npm, /if: github.event_name == 'workflow_dispatch' \|\| startsWith\(github.event.release.tag_name, 'v'\)/);
  assert.match(plugin, /startsWith\(github.event.release.tag_name, 'plugin-v'\)/);
  assert.match(plugin, /include-hidden-files: true/);
  assert.match(plugin, /default: true/);
  assert.match(plugin, /cancel-in-progress: false/);
  const verify = plugin.indexOf('node "$PLUGIN_PUBLISHER" --verify');
  assert.ok(verify >= 0 && verify < plugin.indexOf('--publish'));
  assert.doesNotMatch(plugin, /npm publish|--force|--clobber/);
});

test('publisher lookup supports immutable old source tags and prefers the new layout', async t => {
  const workflow = await readFile(join(repository, '.github/workflows', pluginWorkflow), 'utf8');
  const lookup = workflow.match(/      - name: Locate the publisher in the tagged source\n        run: \|\n([\s\S]*?)\n      - name:/)?.[1];
  assert.ok(lookup);
  for (const paths of [[], ['scripts/publish-plugin.ts'], ['agents/scripts/publish-plugin.ts'],
    ['scripts/publish-plugin.ts', 'agents/scripts/publish-plugin.ts']]) {
    const root = await temporary(t);
    const environment = join(root, 'environment');
    await writeFile(environment, '');
    for (const path of paths) {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), '');
    }
    const result: SpawnSyncReturns<string> = spawnSync('bash', ['-eu', '-c', lookup], {
      cwd: root, env: { ...process.env, GITHUB_ENV: environment }, encoding: 'utf8',
    });
    assert.equal(result.status, paths.length ? 0 : 1, result.stderr);
    assert.equal(await readFile(environment, 'utf8'), paths.length
      ? `PLUGIN_PUBLISHER=${paths.includes('agents/scripts/publish-plugin.ts') ? 'agents/scripts/publish-plugin.ts' : 'scripts/publish-plugin.ts'}\n`
      : '');
  }
});

test('workflow tag validation rejects multiline output injection before checkout', async () => {
  const workflow = await readFile(join(repository, '.github/workflows', pluginWorkflow), 'utf8');
  const guard = workflow.match(/        run: \|\n([\s\S]*?)\n      - uses:/)?.[1];
  assert.ok(guard);
  for (const tag of ['plugin-v0.1.0', 'v0.1.0', 'plugin-v01.0.0', 'plugin-v0.1.0\nother=value', 'plugin-v0.1.0\n', 'plugin-v1.0.0;exit 0']) {
    const result: SpawnSyncReturns<string> = spawnSync('bash', ['-c', guard], {
      env: { ...process.env, REQUESTED_TAG: tag, GITHUB_OUTPUT: '/dev/null' }, encoding: 'utf8',
    });
    assert.equal(result.status, tag === 'plugin-v0.1.0' ? 0 : 1, tag);
  }
});
