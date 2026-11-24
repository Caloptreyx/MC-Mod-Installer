import { useQuery } from '@tanstack/react-query';
import { useServerStore } from '@/stores/server.ts';
import { getStatus } from '../api/curseforge.ts';
import { modInstallerQueryKey } from '../lib/constants.ts';

/** Whether an administrator configured CurseForge (false while loading or on errors). */
export function useCurseforgeStatus(): boolean {
  const serverUuid = useServerStore((state) => state.server.uuid);
  const { data } = useQuery({
    queryKey: modInstallerQueryKey('curseforge-status', serverUuid),
    queryFn: () => getStatus(serverUuid),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return data === true;
}
