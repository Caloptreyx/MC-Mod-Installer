import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import { useServerStore } from '@/stores/server.ts';
import { identifyByFingerprints } from '../api/curseforge.ts';
import {
  getLatestVersionsByHashes,
  getProjects,
  getProjectVersions,
  getVersionsByHashes,
  getVersionsOfFile,
  type ModrinthProject,
} from '../api/modrinth.ts';
import getInstalledModFiles from '../api/server/getInstalledModFiles.ts';
import {
  fromModrinthProject,
  fromModrinthVersion,
  type ModSummary,
  type ModVersion,
  sortNewestFirst,
} from '../lib/catalog.ts';
import { type ModSource, modInstallerQueryKey } from '../lib/constants.ts';
import { type IdentifiedMod, type InstalledMod, withIssues } from '../lib/issues.ts';
import { platformMismatch } from '../lib/versions.ts';
import { useCurseforgeStatus } from './useCurseforgeStatus.ts';
import { useModEnvironment } from './useModEnvironment.ts';

export type { InstalledMod } from '../lib/issues.ts';

/** Fallback lookups when Modrinth's update endpoint returns a pre-release. */
const MAX_RELEASE_LOOKUPS = 20;
/** Files whose other Modrinth versions are looked up before flagging a wrong loader / version. */
const MAX_FILE_VERSION_LOOKUPS = 30;

interface ModrinthIdentification {
  versions: Record<string, ModVersion>;
  projects: Record<string, ModrinthProject>;
}

async function identifyOnModrinth(hashes: string[]): Promise<ModrinthIdentification> {
  const raw = await getVersionsByHashes(hashes);
  const versions = Object.fromEntries(
    Object.entries(raw).map(([hash, version]) => [hash, fromModrinthVersion(version)]),
  );
  // Also load required dependencies, to tell whether they are installed under another file.
  const projectIds = [
    ...new Set(
      Object.values(versions).flatMap((version) => [
        version.projectId,
        ...version.dependencies.flatMap((dependency) => (dependency.projectId ? [dependency.projectId] : [])),
      ]),
    ),
  ];
  const projects: Record<string, ModrinthProject> = {};
  for (let start = 0; start < projectIds.length; start += 100) {
    for (const project of await getProjects(projectIds.slice(start, start + 100))) projects[project.id] = project;
  }

  return { versions, projects };
}

/** The newest release per installed Modrinth file (keyed by SHA-1), when newer than the installed version. */
async function modrinthUpdates(
  installed: Record<string, ModVersion>,
  loaders: string[],
  minecraftVersion: string,
): Promise<Record<string, ModVersion>> {
  const latest = await getLatestVersionsByHashes(Object.keys(installed), loaders, [minecraftVersion]);
  const updates: Record<string, ModVersion> = {};
  let lookups = 0;

  for (const [hash, raw] of Object.entries(latest)) {
    const current = installed[hash];
    let candidate: ModVersion | undefined = fromModrinthVersion(raw);
    if (candidate.channel !== 'release') {
      // The newest file is a pre-release; look for the newest release instead.
      if (lookups++ >= MAX_RELEASE_LOOKUPS) continue;
      const versions = sortNewestFirst(
        (await getProjectVersions(current.projectId, { loaders, gameVersions: [minecraftVersion] })).map(
          fromModrinthVersion,
        ),
      );
      candidate = versions.find((version) => version.channel === 'release');
    }
    if (candidate && candidate.id !== current.id && Date.parse(candidate.published) > Date.parse(current.published)) {
      updates[hash] = candidate;
    }
  }

  return updates;
}

/**
 * Mods in the server's mods directory, identified on Modrinth by SHA-1 and on CurseForge by
 * fingerprint, with available updates and problems a loader would trip over.
 */
export function useInstalledMods() {
  const serverUuid = useServerStore((state) => state.server.uuid);
  const queryClient = useQueryClient();
  const filesQueryKey = modInstallerQueryKey('mods', serverUuid);
  const curseforge = useCurseforgeStatus();
  const { serverLoaders, minecraftVersion, loading: environmentLoading } = useModEnvironment();

  const files = useQuery({
    queryKey: filesQueryKey,
    queryFn: () => getInstalledModFiles(serverUuid),
  });

  const hashes = useMemo(
    () => [...new Set((files.data?.mods ?? []).flatMap((file) => (file.sha1 ? [file.sha1] : [])))].sort(),
    [files.data],
  );

  const modrinth = useQuery({
    queryKey: modInstallerQueryKey('identify', hashes),
    queryFn: () => identifyOnModrinth(hashes),
    enabled: hashes.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  // CurseForge only for files Modrinth doesn't know.
  const fingerprints = useMemo(() => {
    if (!files.data || (hashes.length > 0 && !modrinth.data && !modrinth.error)) return [];
    return [
      ...new Set(
        files.data.mods.flatMap((file) =>
          file.fingerprint !== null && !(file.sha1 && modrinth.data?.versions[file.sha1]) ? [file.fingerprint] : [],
        ),
      ),
    ].sort((a, b) => a - b);
  }, [files.data, hashes, modrinth.data, modrinth.error]);

  const curseforgeMatches = useQuery({
    queryKey: modInstallerQueryKey('identify-curseforge', serverUuid, fingerprints, serverLoaders, minecraftVersion),
    queryFn: () => identifyByFingerprints(serverUuid, fingerprints, serverLoaders, minecraftVersion),
    enabled: curseforge && fingerprints.length > 0 && !environmentLoading,
    staleTime: 10 * 60 * 1000,
  });

  const installedModrinth = modrinth.data?.versions;
  const updates = useQuery({
    queryKey: modInstallerQueryKey('updates', hashes, serverLoaders, minecraftVersion),
    queryFn: () => modrinthUpdates(installedModrinth!, serverLoaders, minecraftVersion!),
    enabled:
      !!installedModrinth &&
      Object.keys(installedModrinth).length > 0 &&
      serverLoaders.length > 0 &&
      !!minecraftVersion,
    staleTime: 10 * 60 * 1000,
  });

  // Modrinth often attaches the same jar to several versions (one per loader) but `version_files`
  // returns one of them; before flagging a mismatch, look for a version of that file that fits.
  const mismatched = useMemo(
    () =>
      Object.entries(installedModrinth ?? {})
        .filter(([, version]) => {
          const mismatch = platformMismatch(version, serverLoaders, minecraftVersion);
          return mismatch.loader || mismatch.gameVersion;
        })
        .map(([hash]) => hash)
        .slice(0, MAX_FILE_VERSION_LOOKUPS),
    [installedModrinth, serverLoaders, minecraftVersion],
  );
  const fitting = useQuery({
    queryKey: modInstallerQueryKey('fitting-versions', mismatched, serverLoaders, minecraftVersion),
    queryFn: async () => {
      const found: Record<string, ModVersion> = {};
      for (const hash of mismatched) {
        const versions = (await getVersionsOfFile(hash)).map(fromModrinthVersion);
        const fits = versions.find((version) => {
          const mismatch = platformMismatch(version, serverLoaders, minecraftVersion);
          return !mismatch.loader && !mismatch.gameVersion;
        });
        if (fits) found[hash] = fits;
      }
      return found;
    },
    enabled: mismatched.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const mods = useMemo<InstalledMod[] | undefined>(() => {
    if (!files.data) return undefined;

    const identified: IdentifiedMod[] = files.data.mods.map((file) => {
      const version = (file.sha1 && (fitting.data?.[file.sha1] ?? modrinth.data?.versions[file.sha1])) || null;
      const project = version ? modrinth.data?.projects[version.projectId] : undefined;
      if (version) {
        return {
          ...file,
          source: 'modrinth' as ModSource,
          project: project ? fromModrinthProject(project) : null,
          version,
          update: (file.sha1 && updates.data?.[file.sha1]) || null,
        };
      }
      const match = file.fingerprint !== null ? curseforgeMatches.data?.matches.get(file.fingerprint) : undefined;
      if (match) {
        return {
          ...file,
          source: 'curseforge' as ModSource,
          project: match.project,
          version: match.file,
          update: match.update,
        };
      }
      return { ...file, source: null, project: null, version: null, update: null };
    });

    const dependencies = new Map<string, ModSummary>();
    for (const project of Object.values(modrinth.data?.projects ?? {})) {
      dependencies.set(`modrinth:${project.id}`, fromModrinthProject(project));
    }
    for (const summary of curseforgeMatches.data?.dependencies ?? []) {
      dependencies.set(`curseforge:${summary.id}`, summary);
    }

    return withIssues(identified, {
      // Until every version of a mismatching file was checked, flag no loader / version problems.
      serverLoaders: fitting.isLoading ? [] : serverLoaders,
      minecraftVersion: fitting.isLoading ? null : minecraftVersion,
      dependencies,
      pack: files.data.pack,
    });
  }, [files.data, modrinth.data, fitting.data, curseforgeMatches.data, updates.data, serverLoaders, minecraftVersion]);

  const byProject = useMemo(
    () =>
      new Map(
        (mods ?? []).flatMap((mod) =>
          mod.project && mod.source ? [[`${mod.source}:${mod.project.id}`, mod] as const] : [],
        ),
      ),
    [mods],
  );

  const identifyError = modrinth.error ?? curseforgeMatches.error;

  return {
    mods,
    pack: files.data?.pack ?? null,
    /** Installed file of a project, by source and project id. */
    installedProject: (source: ModSource, projectId: string) => byProject.get(`${source}:${projectId}`) ?? null,
    /** Names of every file in `mods/`. */
    fileNames: new Set((files.data?.mods ?? []).map((mod) => mod.fileName)),
    loading: files.isLoading,
    identifying: (modrinth.isLoading && hashes.length > 0) || curseforgeMatches.isLoading,
    checkingUpdates: updates.isLoading,
    error: files.error ? httpErrorToHuman(files.error) : null,
    identifyError: identifyError ? httpErrorToHuman(identifyError) : null,
    refreshing: files.isFetching,
    refresh: () => queryClient.invalidateQueries({ queryKey: filesQueryKey }),
  };
}
