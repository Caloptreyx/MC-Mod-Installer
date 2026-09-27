export const EXTENSION_ID = 'dev.caloptreyx.modinstaller';

/** Directory that mod loaders read mods from. */
export const MODS_ROOT = '/mods';
export const DISABLED_SUFFIX = '.disabled';

export const MOD_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'] as const;
export type ModLoader = (typeof MOD_LOADERS)[number];

export const isModLoader = (value: string | null | undefined): value is ModLoader =>
  !!value && (MOD_LOADERS as readonly string[]).includes(value);

const LOADER_LABELS: Record<ModLoader, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
};

const LOADER_COLORS: Record<ModLoader, string> = {
  fabric: 'yellow',
  quilt: 'violet',
  forge: 'blue',
  neoforge: 'orange',
};

/** Human readable name of a Modrinth loader, e.g. `neoforge` -> `NeoForge`. */
export const loaderLabel = (loader: string): string =>
  isModLoader(loader) ? LOADER_LABELS[loader] : loader.charAt(0).toUpperCase() + loader.slice(1);

export const loaderColor = (loader: string): string => (isModLoader(loader) ? LOADER_COLORS[loader] : 'gray');

export const modInstallerQueryKey = (...parts: unknown[]) => ['extensions', EXTENSION_ID, ...parts] as const;

export const serverModsPath = (uuidShort: number | string, path = '') => `/server/${uuidShort}/mods${path}`;
