import type { ModrinthVersion, ModrinthVersionFile } from '../api/modrinth.ts';
import { isModLoader } from './constants.ts';

export const primaryFile = (version: ModrinthVersion): ModrinthVersionFile | undefined =>
  version.files.find((file) => file.primary) ?? version.files[0];

export const sortNewestFirst = (versions: ModrinthVersion[]): ModrinthVersion[] =>
  [...versions].sort((a, b) => Date.parse(b.date_published) - Date.parse(a.date_published));

/**
 * Loaders a mod can be installed for, in a stable order.
 * Falls back to every loader Modrinth lists when none of them is a known mod loader.
 */
export function installableLoaders(versions: ModrinthVersion[]): string[] {
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
  loader: string | null;
  gameVersion: string | null;
}

export const matchesFilter = (version: ModrinthVersion, { loader, gameVersion }: VersionFilter): boolean =>
  (!loader || version.loaders.includes(loader)) && (!gameVersion || version.game_versions.includes(gameVersion));

/** The version to preselect: the newest release, else the newest pre-release. Expects newest-first input. */
export const preferredVersion = (versions: ModrinthVersion[]): ModrinthVersion | undefined =>
  versions.find((version) => version.version_type === 'release') ?? versions[0];

export const formatCount = (value: number): string =>
  new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value);
