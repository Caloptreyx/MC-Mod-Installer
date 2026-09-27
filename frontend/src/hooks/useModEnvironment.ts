import { useResource } from '@/plugins/resource/useResource.ts';
import { useServerStore } from '@/stores/server.ts';
import getServerEnvironment from '../api/server/getServerEnvironment.ts';
import { modInstallerQueryKey } from '../lib/constants.ts';

/** The mod loader and Minecraft version detected for the current server. */
export function useModEnvironment() {
  const serverUuid = useServerStore((state) => state.server.uuid);

  const { data, loading, error } = useResource({
    queryKey: modInstallerQueryKey('environment', serverUuid),
    queryFn: () => getServerEnvironment(serverUuid),
  });

  return { environment: data, loading: loading && !data, error };
}
