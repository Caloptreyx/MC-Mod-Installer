import { AxiosError } from 'axios';
import { axiosInstance, getHttpStatus } from '@/api/axios.ts';
import deleteFiles from '@/api/server/files/deleteFiles.ts';
import getFileUploadUrl from '@/api/server/files/getFileUploadUrl.ts';
import renameFiles from '@/api/server/files/renameFiles.ts';
import saveFileContent from '@/api/server/files/saveFileContent.ts';
import type { ModVersion, ModVersionFile } from './catalog.ts';
import verifyModFile, { type VerifyAlgorithm } from '../api/server/verifyModFile.ts';
import { getExtTranslations } from '../translations.ts';
import { DISABLED_SUFFIX, MODS_ROOT, OVERRIDE_FILE, type Software } from './constants.ts';
import { isAllowedDownload, isSafeJarName, temporaryUploadName } from './files.ts';

/** An installed file as the actions need it. */
export interface ModFileRef {
  fileName: string;
  enabled: boolean;
}

/** A failure with a message meant for the user. */
export class ModActionError extends Error {}

/** Called while waiting out the panel's download limit, with the seconds to wait. */
export type WaitCallback = (seconds: number) => void;

export interface InstallOptions {
  /** The installed file of the same mod; it is replaced by the new version. */
  replacing: ModFileRef | null;
  /** Names of every file in `mods/`, to never overwrite an unrelated file. */
  existing: ReadonlySet<string>;
  /** Wait for the download limit instead of failing (bulk installs). */
  onWait?: WaitCallback;
}

const t = () => getExtTranslations().t;
const lower = (names: ReadonlySet<string>) => new Set([...names].map((name) => name.toLowerCase()));

/** Seconds the panel asks to wait after a 429 (its file pull limit), else `null`. */
export function retryAfterSeconds(error: unknown): number | null {
  if (!(error instanceof AxiosError) || error.response?.status !== 429) return null;

  const header = Number(error.response.headers['retry-after']);
  if (Number.isFinite(header) && header >= 0) return header;
  const message = JSON.stringify(error.response.data ?? '');
  const match = /retry in (\d+)s/.exec(message);
  return match ? Number(match[1]) : 60;
}

/** Downloads `url` into `mods/` as `name`; resolves once the file is fully written. */
async function pull(serverUuid: string, url: string, name: string, onWait?: WaitCallback): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await axiosInstance.post(`/api/client/servers/${serverUuid}/files/pull`, {
        root: MODS_ROOT,
        url,
        name,
        foreground: true,
      });
      return;
    } catch (error) {
      const wait = retryAfterSeconds(error);
      if (wait === null) throw error;
      if (!onWait || attempt >= 3 || wait > 120) {
        throw new ModActionError(t()('pages.server.mods.errors.pullLimited', { seconds: wait }));
      }
      onWait(wait);
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, (wait + 1) * 1000);
      await promise;
    }
  }
}

function expectRenamed(result: { renamed: number }, file: string) {
  if (result.renamed !== 1) throw new ModActionError(t()('pages.server.mods.errors.notRenamed', { file }));
}

function expectDeleted(result: { deleted: number }, file: string) {
  if (result.deleted !== 1) throw new ModActionError(t()('pages.server.mods.errors.notDeleted', { file }));
}

/**
 * Deletes files like the file manager does (into the trash). Nodes without a trash answer 404 for
 * that route; they get a permanent delete instead. Returns how many files were deleted.
 */
async function remove(serverUuid: string, root: string, files: string[]): Promise<number> {
  try {
    return (await deleteFiles(serverUuid, root, files)).deleted;
  } catch (error) {
    if (getHttpStatus(error) !== 404) throw error;
    return (await deleteFiles(serverUuid, root, files, true)).deleted;
  }
}

const rename = async (serverUuid: string, from: string, to: string) =>
  expectRenamed(await renameFiles({ uuid: serverUuid, root: MODS_ROOT, files: [{ from, to }] }), from);

/** Best effort clean-up after a failure; the original error is what the user needs to see. */
const quietly = async (action: () => Promise<unknown>) => {
  try {
    await action();
  } catch {
    // ignored
  }
};

/** The hash to compare after a download: Modrinth SHA-512, CurseForge fingerprint, else SHA-1. */
function expectedHash(file: ModVersionFile): [VerifyAlgorithm, string] | null {
  if (file.sha512) return ['sha512', file.sha512];
  if (file.fingerprint !== null) return ['curseforge', String(file.fingerprint)];
  if (file.sha1) return ['sha1', file.sha1];
  return null;
}

async function verify(serverUuid: string, name: string, file: ModVersionFile): Promise<void> {
  const expected = expectedHash(file);
  if (!expected) return;
  if (!(await verifyModFile(serverUuid, name, expected[0], expected[1]))) {
    throw new ModActionError(t()('pages.server.mods.errors.hashMismatch', { file: name }));
  }
}

/** The name the new file gets: the old file's enabled state carries over. */
const targetName = (file: ModVersionFile, replacing: ModFileRef | null) =>
  replacing && !replacing.enabled ? `${file.filename}${DISABLED_SUFFIX}` : file.filename;

function checkFree(target: string, { replacing, existing }: InstallOptions) {
  const names = lower(existing);
  const base = target.toLowerCase().replace(/\.disabled$/, '');
  const replaced = replacing?.fileName.toLowerCase();
  for (const name of [base, `${base}${DISABLED_SUFFIX}`]) {
    if (names.has(name) && name !== replaced) {
      throw new ModActionError(t()('pages.server.mods.errors.exists', { file: name }));
    }
  }
}

/**
 * Puts a new file into place under `target`, where `place(name)` writes it (download or rename of an
 * upload) and checks it. Same name as the old file: the old file is kept as `<name>.backup` until the new
 * one is checked, and restored on failure. Different name: the old file is deleted afterwards; if that
 * fails the error names the file that is left.
 */
async function replaceSafely(
  serverUuid: string,
  target: string,
  options: InstallOptions,
  place: (name: string) => Promise<void>,
): Promise<void> {
  const { replacing } = options;

  if (replacing && replacing.fileName === target) {
    const backup = `${target}.backup`;
    await quietly(() => remove(serverUuid, MODS_ROOT, [backup]));
    await rename(serverUuid, target, backup);
    try {
      await place(target);
    } catch (error) {
      await quietly(() => remove(serverUuid, MODS_ROOT, [target]));
      try {
        await rename(serverUuid, backup, target);
      } catch {
        throw new ModActionError(t()('pages.server.mods.errors.backupKept', { file: backup, original: target }));
      }
      throw error;
    }
    await quietly(() => remove(serverUuid, MODS_ROOT, [backup]));
    return;
  }

  checkFree(target, options);
  await place(target);
  if (replacing) {
    let deleted = 0;
    try {
      deleted = await remove(serverUuid, MODS_ROOT, [replacing.fileName]);
    } catch {
      deleted = 0;
    }
    if (deleted !== 1) {
      throw new ModActionError(t()('pages.server.mods.errors.oldKept', { file: replacing.fileName }));
    }
  }
}

/** Whether a version can be installed straight from its source. */
export const canDownload = (version: ModVersion) =>
  !!version.file &&
  isSafeJarName(version.file.filename) &&
  version.downloadable &&
  !!version.file.url &&
  isAllowedDownload(version.source, version.file.url);

/** Downloads `version` into `mods/`, checks its hash and replaces `options.replacing` safely. */
export async function installVersion(serverUuid: string, version: ModVersion, options: InstallOptions): Promise<void> {
  const file = version.file;
  if (!file || !isSafeJarName(file.filename)) {
    throw new ModActionError(t()('pages.server.mods.errors.noJar', { version: version.versionNumber }));
  }
  if (!canDownload(version) || !file.url) {
    throw new ModActionError(t()('pages.server.mods.errors.notDownloadable', { version: version.versionNumber }));
  }
  const url = file.url;

  await replaceSafely(serverUuid, targetName(file, options.replacing), options, async (name) => {
    await pull(serverUuid, url, name, options.onWait);
    try {
      await verify(serverUuid, name, file);
    } catch (error) {
      await quietly(() => remove(serverUuid, MODS_ROOT, [name]));
      throw error;
    }
  });
}

/**
 * Installs a jar the user downloaded from CurseForge themselves: it is uploaded under a temporary
 * name no loader reads, its CurseForge fingerprint (or SHA-1) is checked against `version`, and
 * only then it is renamed into place.
 */
export async function installUploadedJar(
  serverUuid: string,
  jar: File,
  version: ModVersion,
  options: InstallOptions,
): Promise<void> {
  const file = version.file;
  if (!file || !isSafeJarName(file.filename)) {
    throw new ModActionError(t()('pages.server.mods.errors.noJar', { version: version.versionNumber }));
  }
  const expected: [VerifyAlgorithm, string] | null =
    file.fingerprint !== null ? ['curseforge', String(file.fingerprint)] : file.sha1 ? ['sha1', file.sha1] : null;
  if (!expected) {
    throw new ModActionError(t()('pages.server.mods.errors.cannotVerify', {}));
  }

  const temporary = temporaryUploadName();
  const { url } = await getFileUploadUrl(serverUuid, MODS_ROOT);
  const form = new FormData();
  form.append('files', jar, temporary);
  await axiosInstance.post(url, form);

  let matches = false;
  try {
    matches = await verifyModFile(serverUuid, temporary, expected[0], expected[1]);
  } finally {
    if (!matches) await quietly(() => remove(serverUuid, MODS_ROOT, [temporary]));
  }
  if (!matches) throw new ModActionError(t()('pages.server.mods.errors.notTheFile', {}));

  try {
    await replaceSafely(serverUuid, targetName(file, options.replacing), options, (name) =>
      rename(serverUuid, temporary, name),
    );
  } catch (error) {
    await quietly(() => remove(serverUuid, MODS_ROOT, [temporary]));
    throw error;
  }
}

/** Enables (`x.jar.disabled` -> `x.jar`) or disables a mod; refuses when the target name exists. */
export async function setModEnabled(
  serverUuid: string,
  mod: ModFileRef,
  enabled: boolean,
  existing: ReadonlySet<string>,
): Promise<void> {
  const to = enabled ? mod.fileName.slice(0, -DISABLED_SUFFIX.length) : `${mod.fileName}${DISABLED_SUFFIX}`;
  if (lower(existing).has(to.toLowerCase())) {
    throw new ModActionError(t()('pages.server.mods.errors.exists', { file: to }));
  }

  await rename(serverUuid, mod.fileName, to);
}

export async function deleteMod(serverUuid: string, mod: ModFileRef): Promise<void> {
  expectDeleted({ deleted: await remove(serverUuid, MODS_ROOT, [mod.fileName]) }, mod.fileName);
}

export interface SoftwareOverride {
  software: Software;
  minecraftVersion: string | null;
  loaderVersion: string | null;
}

/** Writes `/.mc-mod-installer.json`, which detection ranks above everything else. */
export async function saveOverride(serverUuid: string, value: SoftwareOverride): Promise<void> {
  const content = JSON.stringify({ override: value, setAt: new Date().toISOString() }, null, 2);
  await saveFileContent(serverUuid, `/${OVERRIDE_FILE}`, `${content}\n`);
}

export async function clearOverride(serverUuid: string): Promise<void> {
  expectDeleted({ deleted: await remove(serverUuid, '/', [OVERRIDE_FILE]) }, OVERRIDE_FILE);
}
