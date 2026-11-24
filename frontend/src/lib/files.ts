import type { ModSource } from './constants.ts';

/** Hosts mod downloads may come from; https only, exact host. */
const DOWNLOAD_HOSTS: Record<ModSource, readonly string[]> = {
  modrinth: ['cdn.modrinth.com'],
  curseforge: ['edge.forgecdn.net', 'mediafilez.forgecdn.net'],
};

const hasControlChars = (text: string) =>
  [...text].some((char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || code === 0x7f;
  });

/**
 * Whether `name` may be written into `mods/`: one path segment, no leading dot, no control
 * characters, a `.jar` (not a sources jar).
 */
export function isSafeJarName(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    name.length > 4 &&
    name.length <= 255 &&
    !name.startsWith('.') &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !hasControlChars(name) &&
    lower.endsWith('.jar') &&
    !lower.endsWith('-sources.jar')
  );
}

/** Whether `url` is an https download from the source's own CDN. */
export function isAllowedDownload(source: ModSource, url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && DOWNLOAD_HOSTS[source].includes(parsed.hostname);
  } catch {
    return false;
  }
}

/** Only http(s) links are rendered. */
export function safeLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null;
  } catch {
    return null;
  }
}

/** A temporary upload name in `mods/` that no mod loader loads. */
export function temporaryUploadName(): string {
  const random = Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
  return `.mcmi-upload-${random}.tmp`;
}

/** The file name without `.jar` / `.jar.disabled`. */
export const stripJarExtension = (name: string) => name.replace(/\.jar(\.disabled)?$/i, '');
