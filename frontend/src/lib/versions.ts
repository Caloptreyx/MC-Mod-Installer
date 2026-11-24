import type { ModVersion } from './catalog.ts';
import { isModLoader } from './constants.ts';

/**
 * Loaders a mod can be installed for, in a stable order.
 * Falls back to every loader listed when none of them is a known mod loader.
 */
export function installableLoaders(versions: ModVersion[]): string[] {
  const loaders = new Set(versions.flatMap((version) => version.loaders));
  const modLoaders = [...loaders].filter(isModLoader);

  return (modLoaders.length > 0 ? modLoaders : [...loaders]).sort();
}

/**
 * Orders Minecraft versions newest first. `order` maps a version to its index in Modrinth's
 * game version tag list (which is sorted newest first); versions missing from it are compared
 * numerically, segment by segment.
 */
export function compareGameVersions(a: string, b: string, order: Map<string, number>): number {
  const indexA = order.get(a);
  const indexB = order.get(b);
  if (indexA !== undefined && indexB !== undefined) return indexA - indexB;

  const partsA = a.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  const partsB = b.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
    const diff = (partsB[i] ?? 0) - (partsA[i] ?? 0);
    if (diff !== 0) return diff;
  }

  return 0;
}

export interface VersionFilter {
  /** Any of these loaders; `null` or empty for all. */
  loaders: string[] | null;
  gameVersion: string | null;
}

export const matchesFilter = (version: ModVersion, { loaders, gameVersion }: VersionFilter): boolean =>
  (!loaders?.length || version.loaders.some((loader) => loaders.includes(loader))) &&
  (!gameVersion || version.gameVersions.includes(gameVersion));

/** The version to preselect: the newest release, else (with pre-releases allowed) the newest one. */
export const preferredVersion = (versions: ModVersion[], includePreReleases = false): ModVersion | undefined =>
  versions.find((version) => version.channel === 'release') ?? (includePreReleases ? versions[0] : undefined);

/**
 * Why a version doesn't fit the server: its loaders don't include one the server loads, or it
 * doesn't list the server's Minecraft version. Unknown server values never count against it.
 */
export function platformMismatch(
  version: Pick<ModVersion, 'loaders' | 'gameVersions'>,
  serverLoaders: readonly string[],
  minecraftVersion: string | null,
): { loader: boolean; gameVersion: boolean } {
  const modLoaders = version.loaders.filter(isModLoader);
  return {
    loader: serverLoaders.length > 0 && modLoaders.length > 0 && !modLoaders.some((l) => serverLoaders.includes(l)),
    gameVersion:
      !!minecraftVersion && version.gameVersions.length > 0 && !version.gameVersions.includes(minecraftVersion),
  };
}

export const formatCount = (value: number): string =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
