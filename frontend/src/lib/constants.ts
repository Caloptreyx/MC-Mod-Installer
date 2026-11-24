export const EXTENSION_ID = 'dev.caloptreyx.modinstaller';

/** Directory that mod loaders read mods from. */
export const MODS_ROOT = '/mods';
export const DISABLED_SUFFIX = '.disabled';
/** Manual override of the detected server software, read by this extension only. */
export const OVERRIDE_FILE = '.mc-mod-installer.json';

export const MOD_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge'] as const;
export type ModLoader = (typeof MOD_LOADERS)[number];

export const isModLoader = (value: string | null | undefined): value is ModLoader =>
  !!value && (MOD_LOADERS as readonly string[]).includes(value);

export const SOFTWARE = [
  'fabric',
  'quilt',
  'forge',
  'neoforge',
  'mohist',
  'arclight',
  'youer',
  'vanilla',
  'paper',
  'purpur',
  'folia',
  'spigot',
  'bukkit',
  'sponge',
  'velocity',
  'bungeecord',
  'waterfall',
] as const;
export type Software = (typeof SOFTWARE)[number];

const SOFTWARE_LABELS: Record<Software, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  mohist: 'Mohist',
  arclight: 'Arclight',
  youer: 'Youer',
  vanilla: 'Vanilla',
  paper: 'Paper',
  purpur: 'Purpur',
  folia: 'Folia',
  spigot: 'Spigot',
  bukkit: 'Bukkit',
  sponge: 'Sponge',
  velocity: 'Velocity',
  bungeecord: 'BungeeCord',
  waterfall: 'Waterfall',
};

const LOADER_COLORS: Record<ModLoader, string> = {
  fabric: 'yellow',
  quilt: 'violet',
  forge: 'blue',
  neoforge: 'orange',
};

const isSoftware = (value: string): value is Software => (SOFTWARE as readonly string[]).includes(value);

/** Human readable name of a loader or server software, e.g. `neoforge` -> `NeoForge`. */
export const loaderLabel = (loader: string): string =>
  isSoftware(loader) ? SOFTWARE_LABELS[loader] : loader.charAt(0).toUpperCase() + loader.slice(1);

export const loaderColor = (loader: string): string => (isModLoader(loader) ? LOADER_COLORS[loader] : 'gray');

export const modInstallerQueryKey = (...parts: unknown[]) => ['extensions', EXTENSION_ID, ...parts] as const;

export const serverModsPath = (uuidShort: number | string, path = '') => `/server/${uuidShort}/mods${path}`;

export type ModSource = 'modrinth' | 'curseforge';

/** Details page of a project. */
export const projectPath = (uuidShort: number | string, source: ModSource, idOrSlug: string) =>
  serverModsPath(uuidShort, source === 'modrinth' ? `/project/${idOrSlug}` : `/curseforge/${idOrSlug}`);

/** CurseForge's own page of a file, for files its author only offers there. */
export const curseforgeFileUrl = (slug: string, fileId: string) =>
  `https://www.curseforge.com/minecraft/mc-mods/${encodeURIComponent(slug)}/files/${encodeURIComponent(fileId)}`;
