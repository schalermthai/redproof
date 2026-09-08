// Packs the publishable packages, installs them into a throwaway project, and
// drives them as a real consumer would.
//
// Usage: node --experimental-strip-types scripts/verify-package.ts

import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO = resolve(import.meta.dirname, '..');

const PACKAGES = [
  { name: 'redproof', tarballPrefix: 'redproof-', probe: 'defineGate' },
  { name: '@redproof/eslint', tarballPrefix: 'redproof-eslint-', probe: 'eslint' },
  { name: '@redproof/dependency-cruiser', tarballPrefix: 'redproof-dependency-cruiser-', probe: 'dependencyCruiser' },
  { name: '@redproof/stryker', tarballPrefix: 'redproof-stryker-', probe: 'stryker' },
  { name: '@redproof/testing', tarballPrefix: 'redproof-testing-', probe: 'testing' },
] as const;

// Node refuses to strip types under node_modules, so shipped source is unusable.
const FORBIDDEN_IN_TARBALL = ['package/src/', 'package/tsconfig'];

const REQUIRED_NODE = '>=24';

let failures = 0;

function report(ok: boolean, label: string, detail = ''): void {
  if (!ok) failures += 1;
  const mark = ok ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${label}${detail ? ` — ${detail}` : ''}`);
}

function run(command: string, args: readonly string[], cwd: string): string {
  return execFileSync(command, args as string[], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function tryRun(command: string, args: readonly string[], cwd: string): { ok: boolean; output: string } {
  try {
    return { ok: true, output: run(command, args, cwd) };
  } catch (error) {
    const shell = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: `${shell.stdout ?? ''}${shell.stderr ?? ''}` || (shell.message ?? '') };
  }
}

const workdir = await mkdtemp(join(tmpdir(), 'redproof-verify-'));
const packDir = join(workdir, 'tarballs');
const consumer = join(workdir, 'consumer');

try {
  console.log(`workspace: ${workdir}\n`);

  console.log('1. Pack the publishable packages');
  await writeFile(join(workdir, '.keep'), '');
  run('mkdir', ['-p', packDir, consumer], workdir);

  const packArgs = PACKAGES.flatMap(pkg => ['-w', pkg.name]);
  run('npm', ['pack', ...packArgs, '--pack-destination', packDir], REPO);
  const packed = run('ls', ['-1', packDir], workdir).trim().split('\n');
  report(packed.length === PACKAGES.length, `packed ${packed.length} of ${PACKAGES.length} packages`);

  console.log('\n2. Check what each tarball contains');
  const tarballs = new Map<string, string>();

  for (const pkg of PACKAGES) {
    const file = packed.find(name => name.startsWith(pkg.tarballPrefix));

    if (file === undefined) {
      report(false, `${pkg.name}: tarball found`);
      continue;
    }

    tarballs.set(pkg.name, join(packDir, file));
    const entries = run('tar', ['-tzf', join(packDir, file)], workdir).split('\n');

    const hasDist = entries.some(entry => entry.startsWith('package/dist/'));
    const leaked = entries.filter(entry => FORBIDDEN_IN_TARBALL.some(bad => entry.startsWith(bad)));
    const hasLicense = entries.includes('package/LICENSE');
    const hasReadme = entries.includes('package/README.md');
    const readme = hasReadme
      ? run('tar', ['-xzOf', join(packDir, file), 'package/README.md'], workdir)
      : '';

    const manifest = JSON.parse(
      run('tar', ['-xzOf', join(packDir, file), 'package/package.json'], workdir),
    ) as {
      types?: string;
      engines?: { node?: string };
      exports?: Record<string, { types?: string; default?: string }>;
    };

    report(hasDist, `${pkg.name}: ships dist/`);
    report(leaked.length === 0, `${pkg.name}: ships no source`, leaked.join(', '));
    report(hasLicense, `${pkg.name}: ships LICENSE`);
    report(hasReadme, `${pkg.name}: ships README.md`);
    if (pkg.name === 'redproof' && hasReadme) {
      report(
        !/\]\((?:\.\/)?docs\//.test(readme),
        `${pkg.name}: README has no links to unshipped relative docs`,
      );
    }
    report(
      manifest.types === './dist/index.d.ts',
      `${pkg.name}: declares a top-level types field`,
      manifest.types ?? '(missing)',
    );
    report(
      manifest.engines?.node === REQUIRED_NODE,
      `${pkg.name}: requires node ${REQUIRED_NODE}`,
      manifest.engines?.node ?? '(missing)',
    );
    if (pkg.name === 'redproof') {
      report(
        manifest.exports?.['./command']?.types === './dist/command/index.d.ts'
          && manifest.exports?.['./command']?.default === './dist/command/index.js',
        'redproof: exports the command subpath with runtime and types',
      );
    }
  }

  console.log('\n3. Install the tarballs into a clean project');
  await writeFile(
    join(consumer, 'package.json'),
    `${JSON.stringify({ name: 'redproof-consumer', version: '1.0.0', type: 'module', private: true }, null, 2)}\n`,
  );

  const install = tryRun('npm', ['install', '--no-audit', '--no-fund', ...tarballs.values()], consumer);
  report(install.ok, 'npm install succeeded', install.ok ? '' : install.output.slice(0, 400));

  if (!install.ok) throw new Error('cannot continue without a successful install');

  console.log('\n4. Import each package at run time');
  for (const pkg of PACKAGES) {
    const probeFile = join(consumer, 'probe.mjs');
    await writeFile(
      probeFile,
      `import * as mod from '${pkg.name}';\n`
      + `if (typeof mod.${pkg.probe} !== 'function') {\n`
      + `  throw new Error('missing export: ${pkg.probe}');\n`
      + `}\n`
      + `console.log('ok');\n`,
    );

    const result = tryRun('node', ['probe.mjs'], consumer);
    report(result.ok, `${pkg.name}: imports and exports ${pkg.probe}()`, result.ok ? '' : result.output.slice(0, 300));
  }

  await writeFile(
    join(consumer, 'probe-command.mjs'),
    "import { command, commands } from 'redproof/command';\n"
    + "if (typeof command !== 'function') throw new Error('missing command export');\n"
    + "if (typeof commands !== 'function') throw new Error('missing commands export');\n",
  );
  const commandImport = tryRun('node', ['probe-command.mjs'], consumer);
  report(commandImport.ok, 'redproof/command imports at run time', commandImport.ok ? '' : commandImport.output.slice(0, 300));

  console.log('\n5. Run the redproof command line tool on a real project');
  run('mkdir', ['-p', join(consumer, 'gates'), join(consumer, 'src')], consumer);

  await writeFile(
    join(consumer, 'redproof.config.ts'),
    "import { defineConfig } from 'redproof';\n"
    + "export default defineConfig({ root: '.', gatesRoot: 'gates/**/*.ts' });\n",
  );

  await writeFile(
    join(consumer, 'gates', 'no-todo.ts'),
    "import { breach, counting, defineGate, defineRules, result, text } from 'redproof';\n"
    + "const rules = defineRules({\n"
    + "  noTodo: { id: 'source/no-todo', description: 'Source must not contain TODO comments.' },\n"
    + '});\n'
    + "export default defineGate({\n"
    + "  id: 'no-todo',\n"
    + '  rules,\n'
    + '  check: {\n'
    + "    description: 'scan source files for TODO comments',\n"
    + '    counting: counting.supported,\n'
    + '    async run(ctx) {\n'
    + '      const startedAt = new Date().toISOString();\n'
    + "      const found = await text.find(ctx, { files: 'src/**/*.ts', find: /\\bTODO\\b/g });\n"
    + '      const scan = {\n'
    + "        source: 'text',\n"
    + '        startedAt,\n'
    + '        finishedAt: new Date().toISOString(),\n'
    + '        inspected: found.files.length,\n'
    + '      };\n'
    + '      return result.fromBreaches(scan, found.matches.map(match => breach(rules.noTodo, {\n'
    + "        code: 'todo-found',\n"
    + "        message: 'TODO comment found.',\n"
    + '        location: match.location,\n'
    + '      })));\n'
    + '    },\n'
    + '  },\n'
    + '});\n',
  );

  await writeFile(join(consumer, 'src', 'clean.ts'), 'export const value = 1;\n');
  const cliGreen = tryRun('node', ['node_modules/.bin/redproof', 'check'], consumer);
  report(cliGreen.ok, 'redproof binary passes a clean project', cliGreen.ok ? '' : cliGreen.output.slice(0, 400));

  await writeFile(join(consumer, 'src', 'clean.ts'), 'export const value = 1; // TODO fix\n');
  const cliRed = tryRun('node', ['node_modules/.bin/redproof', 'check'], consumer);
  report(!cliRed.ok, 'redproof binary fails a broken project', cliRed.ok ? 'check passed when it should have failed' : '');
  report(
    cliRed.output.includes('no-todo') || cliRed.output.includes('TODO'),
    'the failure names the broken rule',
    cliRed.output.slice(0, 200),
  );

  await rm(join(consumer, 'src'), { recursive: true, force: true });
  await rm(join(consumer, 'gates'), { recursive: true, force: true });
  await rm(join(consumer, 'redproof.config.ts'), { force: true });

  console.log('\n6. Type-check a consumer against the published types');
  await writeFile(
    join(consumer, 'tsconfig.json'),
    `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
      },
      include: ['consumer.ts'],
    }, null, 2)}\n`,
  );

  const tsc = join(REPO, 'node_modules', '.bin', 'tsc');

  const green = "import { defineGate, defineRule } from 'redproof';\n"
    + "import { command, commands } from 'redproof/command';\n"
    + "import { stryker } from '@redproof/stryker';\n"
    + "import { vitest } from '@redproof/testing';\n"
    + "const rule = defineRule({ id: 'consumer/command', description: 'command succeeds' });\n"
    + "export const check = command({ rule, command: 'node' });\n"
    + "export const group = commands({ entries: [{ rule, command: 'node' }] });\n"
    + "export const mutation = stryker({ cwd: 'packages/parser', rules: { noNewUndetectedMutants: { acceptedMutantsFile: 'accepted-mutants.json' } } });\n"
    + "export const tests = vitest({ cwd: 'packages/parser', reportFile: 'results.json', rules: { testsPass: true, noFlakyTests: true } });\n"
    + "export const gate = defineGate;\n";
  await writeFile(join(consumer, 'consumer.ts'), green);
  const typesOk = tryRun(tsc, ['-p', 'tsconfig.json'], consumer);
  report(typesOk.ok, 'valid consumer code type-checks', typesOk.ok ? '' : typesOk.output.slice(0, 400));

  console.log('\n7. Red-proof: the type check must reject bad code');
  const red = "import { thisExportDoesNotExist } from 'redproof';\nvoid thisExportDoesNotExist;\n";
  await writeFile(join(consumer, 'consumer.ts'), red);
  const typesRed = tryRun(tsc, ['-p', 'tsconfig.json'], consumer);
  report(!typesRed.ok, 'invalid consumer code is rejected', typesRed.ok ? 'type check passed when it should have failed' : '');

  console.log('\n8. Check every package carries the same version');
  const versions = new Set<string>();

  for (const pkg of PACKAGES) {
    const dir = pkg.name === 'redproof' ? 'redproof' : pkg.name.replace('@redproof/', '');
    const manifest = JSON.parse(
      await readFile(join(REPO, 'packages', dir, 'package.json'), 'utf8'),
    ) as { version?: string; dependencies?: Record<string, string> };

    versions.add(manifest.version ?? 'missing');

    const internal = manifest.dependencies?.redproof;
    if (internal !== undefined) {
      report(internal === manifest.version, `${pkg.name}: depends on redproof@${manifest.version}`, `found ${internal}`);
    }
  }

  report(versions.size === 1, 'all packages share one version', [...versions].join(', '));
} finally {
  await rm(workdir, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'All package checks passed.' : `${failures} package check(s) failed.`}`);
process.exit(failures === 0 ? 0 : 1);
