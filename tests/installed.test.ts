import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModSummary, ModVersion } from '../frontend/src/lib/catalog.ts';
import { isAllowedDownload, isSafeJarName, safeLink } from '../frontend/src/lib/files.ts';
import { type IdentifiedMod, withIssues } from '../frontend/src/lib/issues.ts';
import { platformMismatch } from '../frontend/src/lib/versions.ts';

const summary = (source: 'modrinth' | 'curseforge', id: string, title: string, slug = title.toLowerCase()) =>
  ({
    source,
    id,
    slug,
    title,
    description: '',
    author: '',
    iconUrl: null,
    downloads: 0,
    follows: 0,
    categories: [],
    loaders: [],
    updated: null,
    url: '',
    clientOnly: false,
  }) satisfies ModSummary;

const version = (source: 'modrinth' | 'curseforge', projectId: string, extra: Partial<ModVersion> = {}): ModVersion => ({
  source,
  id: `${projectId}-v`,
  projectId,
  name: '1.0',
  versionNumber: '1.0',
  channel: 'release',
  loaders: ['fabric'],
  gameVersions: ['1.21.1'],
  published: '2026-01-01T00:00:00Z',
  downloads: 0,
  file: null,
  downloadable: true,
  clientOnly: false,
  dependencies: [],
  ...extra,
});

const mod = (fileName: string, extra: Partial<IdentifiedMod> = {}): IdentifiedMod => ({
  fileName,
  enabled: true,
  size: 1,
  modified: new Date(0),
  sha1: null,
  fingerprint: null,
  tooLarge: false,
  source: null,
  project: null,
  version: null,
  update: null,
  ...extra,
});

const context = {
  serverLoaders: ['fabric'],
  minecraftVersion: '1.21.1',
  dependencies: new Map<string, ModSummary>(),
  pack: null,
};

test('file names and download hosts', () => {
  assert.ok(isSafeJarName('sodium-fabric-0.6.13+mc1.21.1.jar'));
  for (const bad of ['../server.jar', 'a/b.jar', '.hidden.jar', 'x-sources.jar', 'readme.txt', 'a\u0000.jar']) {
    assert.ok(!isSafeJarName(bad), bad);
  }
  assert.ok(isAllowedDownload('modrinth', 'https://cdn.modrinth.com/data/AANobbMI/versions/x/sodium.jar'));
  assert.ok(!isAllowedDownload('modrinth', 'http://cdn.modrinth.com/data/x.jar'));
  assert.ok(!isAllowedDownload('modrinth', 'https://cdn.modrinth.com.evil.example/x.jar'));
  assert.ok(isAllowedDownload('curseforge', 'https://mediafilez.forgecdn.net/files/1/2/a.jar'));
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('https://example.com/a'), 'https://example.com/a');
});

test('platform mismatch ignores unknown server values', () => {
  assert.deepEqual(platformMismatch({ loaders: ['forge'], gameVersions: ['1.20.1'] }, ['fabric'], '1.21.1'), {
    loader: true,
    gameVersion: true,
  });
  // Quilt servers load Fabric mods.
  assert.deepEqual(platformMismatch({ loaders: ['fabric'], gameVersions: ['1.21.1'] }, ['quilt', 'fabric'], '1.21.1'), {
    loader: false,
    gameVersion: false,
  });
  assert.deepEqual(platformMismatch({ loaders: ['forge'], gameVersions: ['1.20.1'] }, [], null), {
    loader: false,
    gameVersion: false,
  });
});

test('duplicates, wrong loader, client-only and dependencies are flagged', () => {
  const lithium = summary('modrinth', 'lith', 'Lithium');
  const kotlin = summary('modrinth', 'kotlin', 'Fabric Language Kotlin', 'fabric-language-kotlin');
  const result = withIssues(
    [
      mod('lithium-0.15.1.jar', { source: 'modrinth', project: lithium, version: version('modrinth', 'lith') }),
      mod('lithium-0.15.4.jar', { source: 'modrinth', project: lithium, version: version('modrinth', 'lith') }),
      mod('ledger.jar', {
        source: 'modrinth',
        project: summary('modrinth', 'ledger', 'Ledger'),
        version: version('modrinth', 'ledger', {
          dependencies: [{ projectId: 'kotlin', versionId: null, relation: 'required' }],
        }),
      }),
      mod('sodium.jar', {
        source: 'modrinth',
        project: { ...summary('modrinth', 'sodium', 'Sodium'), clientOnly: true },
        version: version('modrinth', 'sodium'),
      }),
      mod('forgemod.jar', {
        source: 'curseforge',
        project: summary('curseforge', '1', 'Forge Mod'),
        version: version('curseforge', '1', { loaders: ['forge'], gameVersions: ['1.20.1'] }),
      }),
    ],
    { ...context, dependencies: new Map([['modrinth:kotlin', kotlin]]) },
  );

  const kinds = (name: string) => result.find((entry) => entry.fileName === name)!.issues.map((issue) => issue.kind);
  assert.deepEqual(kinds('lithium-0.15.1.jar'), ['duplicate']);
  assert.deepEqual(kinds('ledger.jar'), ['missingDependency']);
  assert.deepEqual(kinds('sodium.jar'), ['clientOnly']);
  assert.deepEqual(kinds('forgemod.jar'), ['loader', 'gameVersion']);
});

test('a dependency installed from the other source counts as installed', () => {
  const result = withIssues(
    [
      mod('ledger.jar', {
        source: 'modrinth',
        project: summary('modrinth', 'ledger', 'Ledger'),
        version: version('modrinth', 'ledger', {
          dependencies: [{ projectId: 'kotlin', versionId: null, relation: 'required' }],
        }),
      }),
      mod('flk.jar', {
        source: 'curseforge',
        project: summary('curseforge', '308769', 'Fabric Language Kotlin', 'fabric-language-kotlin'),
        version: version('curseforge', '308769'),
      }),
    ],
    {
      ...context,
      dependencies: new Map([
        ['modrinth:kotlin', summary('modrinth', 'kotlin', 'Fabric Language Kotlin', 'fabric-language-kotlin')],
      ]),
    },
  );
  assert.deepEqual(result[0].issues, []);
});

test('pack files match by SHA-1 first, then by path', () => {
  const pack = {
    name: 'Pack',
    versionName: '1.0',
    source: 'modrinth',
    projectId: null,
    installedAt: null,
    files: [
      { path: 'mods/a.jar', sha1: 'aaaa', source: 'modrinth', projectId: null, fileId: null },
      { path: 'mods/b.jar', sha1: 'bbbb', source: 'override', projectId: null, fileId: null },
    ],
  };
  const result = withIssues(
    [
      mod('renamed.jar.disabled', { sha1: 'AAAA', enabled: false }),
      mod('b.jar.disabled', { enabled: false }),
      mod('c.jar', { sha1: 'cccc' }),
    ],
    { ...context, pack },
  );
  assert.deepEqual(
    result.map((entry) => entry.fromPack),
    [true, true, false],
  );
});
