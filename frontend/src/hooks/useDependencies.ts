import { useQuery } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server.ts';
import { getProjectFiles, getSummaries } from '../api/curseforge.ts';
import { getProjects, getProjectVersions, getVersion } from '../api/modrinth.ts';
import {
  type DependencyRelation,
  fromModrinthProject,
  fromModrinthVersion,
  type ModSummary,
  type ModVersion,
  sortNewestFirst,
} from '../lib/catalog.ts';
import { modInstallerQueryKey } from '../lib/constants.ts';
import { preferredVersion } from '../lib/versions.ts';

export interface DependencyEntry {
  relation: DependencyRelation;
  project: ModSummary;
  /** For required dependencies that aren't installed: the version that fits the server, if any. */
  version: ModVersion | null;
}

/** Required and incompatible dependencies of `version`, with a fitting version for each required one. */
async function resolve(
  serverUuid: string,
  version: ModVersion,
  loaders: string[],
  minecraftVersion: string | null,
): Promise<DependencyEntry[]> {
  const relevant = version.dependencies.filter((dependency) => dependency.relation !== 'optional');
  if (relevant.length === 0) return [];

  if (version.source === 'modrinth') {
    // Modrinth may name only the version; its project comes with it.
    const pinned = new Map<string, ModVersion>();
    for (const dependency of relevant) {
      if (!dependency.projectId && dependency.versionId) {
        const pinnedVersion = fromModrinthVersion(await getVersion(dependency.versionId));
        pinned.set(pinnedVersion.projectId, pinnedVersion);
      }
    }
    const entries = relevant.flatMap((dependency) => {
      const projectId =
        dependency.projectId ?? [...pinned.values()].find((v) => v.id === dependency.versionId)?.projectId;
      return projectId ? [{ ...dependency, projectId }] : [];
    });
    const projects = new Map(
      (await getProjects([...new Set(entries.map((entry) => entry.projectId))])).map((project) => [
        project.id,
        fromModrinthProject(project),
      ]),
    );

    const resolved: DependencyEntry[] = [];
    for (const entry of entries) {
      const project = projects.get(entry.projectId);
      if (!project) continue;
      let candidate: ModVersion | null = null;
      if (entry.relation === 'required') {
        if (entry.versionId) {
          candidate = pinned.get(entry.projectId) ?? fromModrinthVersion(await getVersion(entry.versionId));
        } else {
          const versions = sortNewestFirst(
            (
              await getProjectVersions(entry.projectId, {
                loaders,
                gameVersions: minecraftVersion ? [minecraftVersion] : undefined,
              })
            ).map(fromModrinthVersion),
          );
          candidate = preferredVersion(versions, true) ?? null;
        }
      }
      resolved.push({ relation: entry.relation, project, version: candidate });
    }
    return resolved;
  }

  const ids = [...new Set(relevant.flatMap((dependency) => (dependency.projectId ? [dependency.projectId] : [])))];
  const projects = new Map((await getSummaries(serverUuid, ids)).map((project) => [project.id, project]));
  const resolved: DependencyEntry[] = [];
  for (const dependency of relevant) {
    const project = dependency.projectId ? projects.get(dependency.projectId) : undefined;
    if (!project) continue;
    let candidate: ModVersion | null = null;
    if (dependency.relation === 'required') {
      const files = await getProjectFiles(serverUuid, project.id, { loaders, gameVersion: minecraftVersion });
      const releases = files.filter((file) => file.channel === 'release');
      candidate = releases.find((file) => file.downloadable) ?? releases[0] ?? files[0] ?? null;
    }
    resolved.push({ relation: dependency.relation, project, version: candidate });
  }
  return resolved;
}

/** Dependencies of the version about to be installed, for the server's loader and Minecraft version. */
export function useDependencies(version: ModVersion | undefined, loaders: string[], minecraftVersion: string | null) {
  const serverUuid = useServerStore((state) => state.server.uuid);

  return useQuery({
    queryKey: modInstallerQueryKey('dependencies', version?.source, version?.id, loaders, minecraftVersion),
    queryFn: () => resolve(serverUuid, version!, loaders, minecraftVersion),
    enabled: !!version,
    staleTime: 5 * 60 * 1000,
  });
}
