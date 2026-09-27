import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import { useServerStore } from '@/stores/server.ts';
import { getProjects, getVersionsByHashes, type ModrinthProject, type ModrinthVersion } from '../api/modrinth.ts';
import getInstalledModFiles from '../api/server/getInstalledModFiles.ts';
import { modInstallerQueryKey } from '../lib/constants.ts';
import type { InstalledModFile } from '../lib/schemas.ts';

export interface InstalledMod extends InstalledModFile {
  /** The Modrinth version whose file matches this file's hash, if any. */
  version: ModrinthVersion | null;
  project: ModrinthProject | null;
}

interface Identification {
  versions: Record<string, ModrinthVersion>;
  projects: Record<string, ModrinthProject>;
}

async function identify(hashes: string[]): Promise<Identification> {
  const versions = await getVersionsByHashes(hashes);
  const projectIds = [...new Set(Object.values(versions).map((version) => version.project_id))];
  const projects = await getProjects(projectIds);

  return { versions, projects: Object.fromEntries(projects.map((project) => [project.id, project])) };
}

/**
 * Mods in the server's mods directory, matched to Modrinth projects by file hash.
 * Files Modrinth doesn't know stay in the list with `project`/`version` set to null.
 */
export function useInstalledMods() {
  const serverUuid = useServerStore((state) => state.server.uuid);
  const queryClient = useQueryClient();
  const filesQueryKey = modInstallerQueryKey('mods', serverUuid);

  const files = useQuery({
    queryKey: filesQueryKey,
    queryFn: () => getInstalledModFiles(serverUuid),
  });

  const hashes = useMemo(
    () => [...new Set((files.data ?? []).flatMap((file) => (file.sha1 ? [file.sha1] : [])))].sort(),
    [files.data],
  );

  const identification = useQuery({
    queryKey: modInstallerQueryKey('identify', hashes),
    queryFn: () => identify(hashes),
    enabled: hashes.length > 0,
    staleTime: 10 * 60 * 1000,
  });

  const mods = useMemo<InstalledMod[] | undefined>(() => {
    if (!files.data) return undefined;

    return files.data.map((file) => {
      const version = (file.sha1 && identification.data?.versions[file.sha1]) || null;
      const project = (version && identification.data?.projects[version.project_id]) || null;

      return { ...file, version, project };
    });
  }, [files.data, identification.data]);

  const byProjectId = useMemo(
    () => new Map((mods ?? []).flatMap((mod) => (mod.project ? [[mod.project.id, mod] as const] : []))),
    [mods],
  );

  return {
    mods,
    byProjectId,
    loading: files.isLoading,
    identifying: identification.isLoading && hashes.length > 0,
    error: files.error ? httpErrorToHuman(files.error) : null,
    identifyError: identification.error ? httpErrorToHuman(identification.error) : null,
    refreshing: files.isFetching,
    refresh: () => queryClient.invalidateQueries({ queryKey: filesQueryKey }),
  };
}
