import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = fileURLToPath(new URL('../../', import.meta.url));

async function readSource(root: string, name: string): Promise<Buffer> {
  const parts = name.split('/');
  if (!parts.length || parts.some(part => !/^[A-Za-z0-9_.-]+$/.test(part) || part === '.' || part === '..')) {
    throw new Error(`Invalid plugin source path: ${name}`);
  }
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || (index < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      throw new Error(`Plugin source must use regular files and directories, not links: ${name}`);
    }
  }
  return readFile(current);
}

function json(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n');
}

/** Build a standalone directory; never clean or overwrite a caller's destination. */
export async function buildPlugin(destination?: string, sourceRoot = repository): Promise<string> {
  const manifest = JSON.parse((await readSource(sourceRoot, 'agents/plugin/redproof/.codex-plugin/plugin.json')).toString());
  if (manifest.name !== 'redproof' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    throw new Error('Expected redproof plugin identity and a release version');
  }
  const files: unknown = JSON.parse((await readSource(sourceRoot, 'agents/plugin/files.json')).toString());
  if (!Array.isArray(files) || !files.length || files.some(file => typeof file !== 'string' || !/^(skills|skill-support)\//.test(file)) || new Set(files).size !== files.length) {
    throw new Error('Plugin file list must contain unique skills/ or skill-support/ paths');
  }

  // Read and validate all inputs before creating any output. No recursive copy.
  const entries = new Map<string, Buffer>();
  // The allowlist is relative to agents/ in source and to the installed bundle.
  // Keeping those paths unchanged preserves skill-to-helper relative links.
  for (const file of files as string[]) entries.set(file, await readSource(sourceRoot, `agents/${file}`));
  entries.set('README.md', await readSource(sourceRoot, 'agents/plugin/redproof/README.md'));
  entries.set('LICENSE', await readSource(sourceRoot, 'LICENSE'));
  entries.set('.codex-plugin/plugin.json', json(manifest));
  const { skills: _skills, interface: presentation, ...identity } = manifest;
  entries.set('plugin.json', json({
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    ...identity,
    extensions: { 'com.openai': { interface: presentation } },
  }));
  entries.set('.claude-plugin/plugin.json', json(identity));
  const hashes = Object.fromEntries([...entries].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
  entries.set('bundle-files.json', json({ version: 1, algorithm: 'sha256', files: hashes }));

  const output = destination ? resolve(destination) : join(await mkdtemp(join(tmpdir(), 'redproof-plugin-')), 'redproof');
  if (basename(output) !== manifest.name) throw new Error('Plugin destination directory must be named redproof');
  // Non-recursive mkdir also refuses existing directories and symlinks.
  await mkdir(output);
  for (const [name, bytes] of entries) {
    const target = join(output, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  return output;
}

async function main(args: string[]): Promise<void> {
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--out' || !args[1] || args[1].startsWith('--'))) {
    throw new Error('Usage: npm run plugin:build -- [--out /existing-parent/redproof]');
  }
  console.log(`Plugin bundle: ${await buildPlugin(args[1])}`);
  console.log('Not installed or published. See the bundled README for validation and local use.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
