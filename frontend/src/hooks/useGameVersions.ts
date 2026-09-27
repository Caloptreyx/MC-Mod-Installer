import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getGameVersions } from '../api/modrinth.ts';
import { modInstallerQueryKey } from '../lib/constants.ts';
import { compareGameVersions } from '../lib/versions.ts';

/** Modrinth's Minecraft version list (newest first) and a comparator ordering versions newest first. */
export function useGameVersions() {
  const { data } = useQuery({
    queryKey: modInstallerQueryKey('game-versions'),
    queryFn: getGameVersions,
    staleTime: Infinity,
  });

  return useMemo(() => {
    const order = new Map((data ?? []).map((gameVersion, index) => [gameVersion.version, index]));

    return {
      releases: (data ?? []).filter((gameVersion) => gameVersion.version_type === 'release').map((v) => v.version),
      compare: (a: string, b: string) => compareGameVersions(a, b, order),
    };
  }, [data]);
}
