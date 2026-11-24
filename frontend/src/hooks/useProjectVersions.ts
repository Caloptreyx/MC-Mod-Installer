import { useQuery } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server.ts';
import { getProjectFiles } from '../api/curseforge.ts';
import { getProjectVersions } from '../api/modrinth.ts';
import { fromModrinthVersion, sortNewestFirst } from '../lib/catalog.ts';
import { type ModSource, modInstallerQueryKey } from '../lib/constants.ts';

/** All versions of a project, newest first. */
export function useProjectVersions(source: ModSource, projectId: string | undefined, enabled = true) {
  const serverUuid = useServerStore((state) => state.server.uuid);

  return useQuery({
    queryKey: modInstallerQueryKey('project', source, projectId, 'versions'),
    queryFn: async () =>
      source === 'modrinth'
        ? sortNewestFirst((await getProjectVersions(projectId!)).map(fromModrinthVersion))
        : sortNewestFirst(await getProjectFiles(serverUuid, projectId!)),
    enabled: !!projectId && enabled,
    staleTime: 5 * 60 * 1000,
  });
}
