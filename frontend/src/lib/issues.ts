import type { ModSummary, ModVersion } from './catalog.ts';
import type { InstalledModFile, PackMarker } from './schemas.ts';
import { DISABLED_SUFFIX, MODS_ROOT, type ModSource } from './constants.ts';
import { platformMismatch } from './versions.ts';

export type ModIssue =
  | { kind: 'duplicate'; files: string[] }
  | { kind: 'loader' }
  | { kind: 'gameVersion' }
  | { kind: 'clientOnly' }
  | { kind: 'missingDependency'; names: string[] }
  | { kind: 'incompatible'; names: string[] };

/** An installed file with what is known about it. */
export interface IdentifiedMod extends InstalledModFile {
  source: ModSource | null;
  project: ModSummary | null;
  version: ModVersion | null;
  /** The newest release for the server's loader and Minecraft version, when newer. */
  update: ModVersion | null;
}

export interface InstalledMod extends IdentifiedMod {
  /** The modpack marker lists this file. */
  fromPack: boolean;
  issues: ModIssue[];
}

export interface IssueContext {
  serverLoaders: readonly string[];
  minecraftVersion: string | null;
  /** Summaries of dependency projects, keyed by `source:id`, to match them across sources and name them. */
  dependencies: ReadonlyMap<string, ModSummary>;
  pack: PackMarker | null;
}

const projectKey = (source: ModSource, id: string) => `${source}:${id}`;
const nameKey = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Whether the pack marker lists `mod`: by SHA-1 first (survives `.disabled` renames), then by path. */
function inPack(mod: InstalledModFile, pack: PackMarker | null): boolean {
  if (!pack?.files) return false;

  const sha1 = mod.sha1?.toLowerCase();
  if (sha1 && pack.files.some((file) => file.sha1 === sha1)) return true;
  const base = mod.fileName.endsWith(DISABLED_SUFFIX) ? mod.fileName.slice(0, -DISABLED_SUFFIX.length) : mod.fileName;
  const paths = [`mods/${base}`, `${MODS_ROOT}/${base}`];
  return pack.files.some((file) => paths.includes(file.path));
}

/**
 * Flags problems a mod loader would trip over: the same mod twice, wrong loader or Minecraft
 * version, client-only mods, missing required and installed incompatible dependencies.
 */
export function withIssues(mods: IdentifiedMod[], context: IssueContext): InstalledMod[] {
  const enabled = mods.filter((mod) => mod.enabled && mod.project && mod.source);
  const installedKeys = new Set(enabled.map((mod) => projectKey(mod.source!, mod.project!.id)));
  // The same mod may be identified on the other source; match those by slug or title.
  const installedNames = new Set(
    enabled.flatMap((mod) => [nameKey(mod.project!.slug), nameKey(mod.project!.title)]).filter(Boolean),
  );

  const byProject = new Map<string, string[]>();
  for (const mod of enabled) {
    const key = projectKey(mod.source!, mod.project!.id);
    byProject.set(key, [...(byProject.get(key) ?? []), mod.fileName]);
  }

  const isInstalled = (source: ModSource, id: string) => {
    if (installedKeys.has(projectKey(source, id))) return true;
    const summary = context.dependencies.get(projectKey(source, id));
    return !!summary && (installedNames.has(nameKey(summary.slug)) || installedNames.has(nameKey(summary.title)));
  };
  const nameOf = (source: ModSource, id: string) => context.dependencies.get(projectKey(source, id))?.title ?? id;

  return mods.map((mod) => {
    const issues: ModIssue[] = [];

    if (mod.enabled && mod.project && mod.source) {
      const files = byProject.get(projectKey(mod.source, mod.project.id)) ?? [];
      if (files.length > 1) issues.push({ kind: 'duplicate', files: files.filter((file) => file !== mod.fileName) });
    }

    if (mod.version) {
      const mismatch = platformMismatch(mod.version, context.serverLoaders, context.minecraftVersion);
      if (mismatch.loader) issues.push({ kind: 'loader' });
      if (mismatch.gameVersion) issues.push({ kind: 'gameVersion' });
    }

    if (mod.project?.clientOnly || mod.version?.clientOnly) issues.push({ kind: 'clientOnly' });

    if (mod.enabled && mod.version && mod.source) {
      const source = mod.source;
      const dependencies = mod.version.dependencies.filter((dependency) => dependency.projectId);
      const missing = dependencies
        .filter((dependency) => dependency.relation === 'required' && !isInstalled(source, dependency.projectId!))
        .map((dependency) => nameOf(source, dependency.projectId!));
      const incompatible = dependencies
        .filter((dependency) => dependency.relation === 'incompatible' && isInstalled(source, dependency.projectId!))
        .map((dependency) => nameOf(source, dependency.projectId!));
      if (missing.length > 0) issues.push({ kind: 'missingDependency', names: missing });
      if (incompatible.length > 0) issues.push({ kind: 'incompatible', names: incompatible });
    }

    return { ...mod, fromPack: inPack(mod, context.pack), issues };
  });
}
