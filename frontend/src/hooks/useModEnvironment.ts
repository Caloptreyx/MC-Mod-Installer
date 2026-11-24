import { useQueryClient } from '@tanstack/react-query';
import { useResource } from '@/plugins/resource/useResource.ts';
import { useServerStore } from '@/stores/server.ts';
import getServerEnvironment from '../api/server/getServerEnvironment.ts';
import { modInstallerQueryKey } from '../lib/constants.ts';

/** The server software, Minecraft and loader version detected for the current server. */
export function useModEnvironment() {
  const serverUuid = useServerStore((state) => state.server.uuid);
  const queryClient = useQueryClient();
  const queryKey = modInstallerQueryKey('environment', serverUuid);

  const { data, loading, error } = useResource({
    queryKey,
    queryFn: () => getServerEnvironment(serverUuid),
  });

  return {
    environment: data,
    loading: loading && !data,
    error,
    /** Loaders whose mods the server loads (Quilt also loads Fabric mods, NeoForge 1.20.1 Forge mods). */
    serverLoaders: data?.modLoaders ?? [],
    minecraftVersion: data?.minecraftVersion?.value ?? null,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
  };
}
