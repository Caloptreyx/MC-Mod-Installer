import { useQuery } from '@tanstack/react-query';
import { getProjectVersions } from '../api/modrinth.ts';
import { modInstallerQueryKey } from '../lib/constants.ts';
import { sortNewestFirst } from '../lib/versions.ts';

/** All versions of a Modrinth project, newest first. */
export function useProjectVersions(projectId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: modInstallerQueryKey('project', projectId, 'versions'),
    queryFn: async () => sortNewestFirst(await getProjectVersions(projectId!)),
    enabled: !!projectId && enabled,
    staleTime: 5 * 60 * 1000,
  });
}
