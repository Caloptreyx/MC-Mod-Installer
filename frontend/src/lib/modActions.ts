import deleteFiles from '@/api/server/files/deleteFiles.ts';
import renameFiles from '@/api/server/files/renameFiles.ts';
import type { ModrinthVersion } from '../api/modrinth.ts';
import pullModFile from '../api/server/pullModFile.ts';
import type { InstalledMod } from '../hooks/useInstalledMods.ts';
import { DISABLED_SUFFIX, MODS_ROOT } from './constants.ts';
import { primaryFile } from './versions.ts';

/**
 * Installs `version` into the mods directory. When `replacing` is given (switching versions),
 * the new file keeps the old file's enabled state and the old file is removed once the
 * download has finished, so a failed download never leaves the server without the mod.
 */
export async function installModVersion(
  serverUuid: string,
  version: ModrinthVersion,
  replacing: InstalledMod | null,
): Promise<void> {
  const file = primaryFile(version);
  if (!file) throw new Error(`Version ${version.version_number} has no downloadable file.`);

  const targetName = replacing && !replacing.enabled ? `${file.filename}${DISABLED_SUFFIX}` : file.filename;
  await pullModFile(serverUuid, file.url, targetName);

  if (replacing && replacing.fileName !== targetName) {
    await deleteFiles(serverUuid, MODS_ROOT, [replacing.fileName]);
  }
}

export async function setModEnabled(serverUuid: string, mod: InstalledMod, enabled: boolean): Promise<void> {
  const to = enabled ? mod.fileName.slice(0, -DISABLED_SUFFIX.length) : `${mod.fileName}${DISABLED_SUFFIX}`;

  await renameFiles({ uuid: serverUuid, root: MODS_ROOT, files: [{ from: mod.fileName, to }] });
}
