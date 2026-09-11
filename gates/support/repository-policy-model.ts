import { posix } from 'node:path';

export type ManifestSnapshot = {
  readonly file: string;
  readonly dir: string;
  readonly name: string;
  readonly version: string;
  readonly manifest: {
    readonly types?: string;
    readonly files?: readonly string[];
    readonly exports?: Readonly<Record<string, string | {
      readonly types?: string;
      readonly default?: string;
    }>>;
    readonly bin?: Readonly<Record<string, string>>;
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
    readonly peerDependencies?: Readonly<Record<string, string>>;
  };
};

export type MarkdownSnapshot = {
  readonly file: string;
  readonly content: string;
};

export type RepositorySnapshot = {
  readonly rootScripts: Readonly<Record<string, string>>;
  readonly rootBuildScript: string;
  readonly manifests: readonly ManifestSnapshot[];
  readonly setVersionSource: string;
  readonly verifyPackageSource: string;
  readonly ciWorkflow: string;
  readonly publishWorkflow: string;
  readonly existingPaths: ReadonlySet<string>;
  readonly markdown: readonly MarkdownSnapshot[];
};

export type RepositoryPolicyRule =
  | 'packageInventory'
  | 'versionAlignment'
  | 'packageBoundaries'
  | 'publicFiles'
  | 'automationVerification'
  | 'docsLinks';

export type RepositoryPolicyFinding = {
  readonly rule: RepositoryPolicyRule;
  readonly code: string;
  readonly message: string;
  readonly file: string;
  readonly detail?: string;
};

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tarballStem(packageName: string): string {
  return packageName.replace(/^@/, '').replaceAll('/', '-');
}

function scriptInvokes(
  scripts: Readonly<Record<string, string>>,
  from: string,
  target: string,
  visited = new Set<string>(),
): boolean {
  if (visited.has(from)) return false;
  visited.add(from);

  const source = scripts[from];
  if (source === undefined) return false;

  const invocations = [...source.matchAll(/\bnpm run ([\w:-]+)/g)].map(match => match[1]!);
  return invocations.includes(target)
    || invocations.some(script => scriptInvokes(scripts, script, target, visited));
}

function workflowRuns(workflow: string, command: string): boolean {
  return new RegExp(`^\\s*run:\\s*${escaped(command)}\\s*$`, 'm').test(workflow);
}

function workflowShellRuns(workflow: string, command: string): boolean {
  return new RegExp(`^\\s*${escaped(command)}(?:\\s|$)`, 'm').test(workflow);
}

function packageInventory(snapshot: RepositorySnapshot): RepositoryPolicyFinding[] {
  const readinessLoop = /for READY_PACKAGE in\s+([^;]+);/.exec(snapshot.publishWorkflow)?.[1]?.split(/\s+/) ?? [];
  const publishLoop = /for PKG in\s+([^;]+);/.exec(snapshot.publishWorkflow)?.[1]?.split(/\s+/) ?? [];
  const findings: RepositoryPolicyFinding[] = [];

  for (const pkg of snapshot.manifests) {
    const expected = [
      {
        file: 'package.json',
        ok: snapshot.rootBuildScript.includes(`tsc -p ${pkg.dir}/tsconfig.build.json`),
        stage: 'root build script',
      },
      {
        file: 'scripts/set-version.ts',
        ok: snapshot.setVersionSource.includes(`'${pkg.dir}'`)
          || snapshot.setVersionSource.includes(`\"${pkg.dir}\"`),
        stage: 'version setter',
      },
      {
        file: 'scripts/verify-package.ts',
        ok: new RegExp(`name:\\s*['\"]${escaped(pkg.name)}['\"]`).test(snapshot.verifyPackageSource),
        stage: 'package verifier',
      },
      {
        file: '.github/workflows/publish.yml',
        ok: readinessLoop.includes(pkg.name),
        stage: 'npm package readiness check',
      },
      {
        file: '.github/workflows/publish.yml',
        ok: snapshot.publishWorkflow.includes(`artifacts/${tarballStem(pkg.name)}-\${VERSION}.tgz`),
        stage: 'verified tarball publish',
      },
      {
        file: '.github/workflows/publish.yml',
        ok: publishLoop.includes(pkg.name),
        stage: 'publish loop',
      },
    ];

    for (const item of expected) {
      if (!item.ok) {
        findings.push({
          rule: 'packageInventory',
          code: 'package-missing-from-release-stage',
          message: `${pkg.name} is missing from the ${item.stage}.`,
          file: item.file,
        });
      }
    }
  }

  return findings;
}

function versionAlignment(snapshot: RepositorySnapshot): RepositoryPolicyFinding[] {
  const findings: RepositoryPolicyFinding[] = [];
  const internalNames = new Set(snapshot.manifests.map(pkg => pkg.name));
  const versions = new Set(snapshot.manifests.map(pkg => pkg.version));
  if (versions.size !== 1) {
    findings.push({
      rule: 'versionAlignment',
      code: 'package-versions-diverge',
      message: 'Publishable packages do not share one version.',
      file: 'packages',
      detail: [...versions].sort().join(', '),
    });
  }

  for (const pkg of snapshot.manifests) {
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      for (const [dependency, version] of Object.entries(pkg.manifest[section] ?? {})) {
        if (internalNames.has(dependency) && version !== pkg.version) {
          findings.push({
            rule: 'versionAlignment',
            code: 'internal-version-diverges',
            message: `${pkg.name} pins ${dependency}@${version} in ${section} instead of ${pkg.version}.`,
            file: pkg.file,
          });
        }
      }
    }
  }
  return findings;
}

function packageBoundaries(snapshot: RepositorySnapshot): RepositoryPolicyFinding[] {
  const findings: RepositoryPolicyFinding[] = [];
  const internalNames = new Set(snapshot.manifests.map(pkg => pkg.name));
  const tck = '@redproof/adapter-tck';

  for (const pkg of snapshot.manifests) {
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies'] as const) {
      for (const dependency of Object.keys(pkg.manifest[section] ?? {})) {
        if (!internalNames.has(dependency)) continue;

        const allowed = pkg.name === 'redproof'
          ? false
          : pkg.name === tck
            ? dependency === 'redproof' && section === 'peerDependencies'
            : (dependency === 'redproof' && section === 'dependencies')
              || (dependency === tck && section === 'devDependencies');
        if (allowed) continue;

        const message = pkg.name === 'redproof'
          ? `redproof must not depend on ${dependency} through ${section}.`
          : dependency === tck
            ? `${pkg.name} may use ${tck} only through devDependencies.`
            : dependency === 'redproof'
              ? `${pkg.name} may use redproof only through dependencies.`
              : `${pkg.name} must not depend on ${dependency} through ${section}.`;
        findings.push({
          rule: 'packageBoundaries',
          code: 'internal-package-boundary-violated',
          message,
          file: pkg.file,
        });
      }
    }
  }

  return findings;
}

function exportTarget(entry: string | { readonly types?: string; readonly default?: string }, key: 'types' | 'default'): string | undefined {
  return typeof entry === 'string' ? (key === 'default' ? entry : undefined) : entry[key];
}

function sourceForTarget(pkg: ManifestSnapshot, target: string): string | undefined {
  const match = /^\.\/dist\/(.+)\.(?:js|d\.ts)$/.exec(target);
  return match ? `${pkg.dir}/src/${match[1]}.ts` : undefined;
}

function publicFiles(snapshot: RepositorySnapshot): RepositoryPolicyFinding[] {
  const findings: RepositoryPolicyFinding[] = [];
  for (const pkg of snapshot.manifests) {
    const rootExport = pkg.manifest.exports?.['.'];
    const rootTypes = rootExport && exportTarget(rootExport, 'types');
    const rootRuntime = rootExport && exportTarget(rootExport, 'default');
    const validRoot = pkg.manifest.types === './dist/index.d.ts'
      && rootTypes === './dist/index.d.ts'
      && rootRuntime === './dist/index.js'
      && pkg.manifest.files?.includes('dist') === true
      && snapshot.existingPaths.has(`${pkg.dir}/src/index.ts`);
    if (!validRoot) {
      findings.push({
        rule: 'publicFiles',
        code: 'invalid-package-entrypoint',
        message: `${pkg.name} must declare matching runtime and type entrypoints backed by source.`,
        file: pkg.file,
      });
    }

    for (const [subpath, entry] of Object.entries(pkg.manifest.exports ?? {})) {
      if (subpath === '.') continue;
      for (const kind of ['types', 'default'] as const) {
        const target = exportTarget(entry, kind);
        const source = target && sourceForTarget(pkg, target);
        if (!target || !source || !snapshot.existingPaths.has(source)) {
          findings.push({
            rule: 'publicFiles',
            code: 'invalid-package-subpath',
            message: `${pkg.name} export ${subpath} has no source-backed ${kind} target.`,
            file: pkg.file,
          });
        }
      }
    }

    for (const [name, target] of Object.entries(pkg.manifest.bin ?? {})) {
      const source = sourceForTarget(pkg, target);
      if (!source || !snapshot.existingPaths.has(source)) {
        findings.push({
          rule: 'publicFiles',
          code: 'invalid-package-bin',
          message: `${pkg.name} binary ${name} has no source-backed target.`,
          file: pkg.file,
        });
      }
    }
  }

  const core = snapshot.manifests.find(pkg => pkg.name === 'redproof');
  const schemas = [
    'packages/redproof/schema/check-report-v1.schema.json',
    'packages/redproof/schema/prove-report-v1.schema.json',
  ];
  if (!core?.manifest.files?.includes('schema') || schemas.some(file => !snapshot.existingPaths.has(file))) {
    findings.push({
      rule: 'publicFiles',
      code: 'public-schema-missing',
      message: 'The core package must declare and contain both public report schemas.',
      file: 'packages/redproof/package.json',
    });
  }
  return findings;
}

function automationVerification(snapshot: RepositorySnapshot): RepositoryPolicyFinding[] {
  const findings: RepositoryPolicyFinding[] = [];
  for (const [script, label] of [['self:check', 'self check'], ['self:prove', 'self proof']] as const) {
    if (!snapshot.rootScripts[script] || !scriptInvokes(snapshot.rootScripts, 'check', script)) {
      findings.push({
        rule: 'automationVerification',
        code: 'self-verification-not-enforced',
        message: `The root check must invoke the ${label} script.`,
        file: 'package.json',
      });
    }
  }

  for (const [file, workflow, commands] of [
    [
      '.github/workflows/ci.yml',
      snapshot.ciWorkflow,
      ['npm run check:quality', 'npm run check:proofs', 'npm run build', 'npm run verify:package'],
    ],
    [
      '.github/workflows/publish.yml',
      snapshot.publishWorkflow,
      ['npm run check', 'npm run build', 'npm run verify:package -- --pack-destination artifacts'],
    ],
  ] as const) {
    for (const command of commands) {
      if (!workflowRuns(workflow, command)) {
        findings.push({
          rule: 'automationVerification',
          code: 'workflow-verification-missing',
          message: `${file} must retain ${command}.`,
          file,
        });
      }
    }
  }

  if (!workflowShellRuns(snapshot.publishWorkflow, 'npm publish "$TARBALL"')) {
    findings.push({
      rule: 'automationVerification',
      code: 'workflow-verification-missing',
      message: '.github/workflows/publish.yml must publish the retained verified tarballs.',
      file: '.github/workflows/publish.yml',
    });
  }
  return findings;
}

function linkTargets(content: string): string[] {
  const inline = [...content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)].map(match => match[1]!);
  const references = [...content.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)].map(match => match[1]!);
  return [...inline, ...references];
}

function localLink(file: string, raw: string): string | undefined {
  const target = raw.replace(/^<|>$/g, '').split(/[?#]/, 1)[0]!;
  if (!target || target.startsWith('/') || /^[a-z][a-z+.-]*:/i.test(target)) return undefined;
  try {
    return posix.normalize(posix.join(posix.dirname(file), decodeURIComponent(target)));
  } catch {
    return posix.normalize(posix.join(posix.dirname(file), target));
  }
}

function docsLinks(snapshot: RepositorySnapshot): RepositoryPolicyFinding[] {
  const findings: RepositoryPolicyFinding[] = [];
  for (const doc of snapshot.markdown) {
    for (const raw of linkTargets(doc.content)) {
      const target = localLink(doc.file, raw);
      const exists = target
        && (snapshot.existingPaths.has(target)
          || [...snapshot.existingPaths].some(path => path.startsWith(`${target.replace(/\/$/, '')}/`)));
      if (target && !exists) {
        findings.push({
          rule: 'docsLinks',
          code: 'broken-relative-doc-link',
          message: `${doc.file} points to missing ${target}.`,
          file: doc.file,
          detail: raw,
        });
      }
    }
  }
  return findings;
}

export function evaluateRepositoryPolicy(snapshot: RepositorySnapshot): RepositoryPolicyFinding[] {
  return [
    ...packageInventory(snapshot),
    ...versionAlignment(snapshot),
    ...packageBoundaries(snapshot),
    ...publicFiles(snapshot),
    ...automationVerification(snapshot),
    ...docsLinks(snapshot),
  ];
}
