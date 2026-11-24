import type { ModSource } from './constants.ts';
import * as modrinth from '../api/modrinth.ts';
import { isAllowedDownload, isSafeJarName, safeLink } from './files.ts';

export type Channel = 'release' | 'beta' | 'alpha';
export type DependencyRelation = 'required' | 'optional' | 'incompatible';

/** A mod as listed by either source. */
export interface ModSummary {
  source: ModSource;
  id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  iconUrl: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  loaders: string[];
  updated: string | null;
  url: string;
  /** The mod does not run on servers (Modrinth `server_side: unsupported`). */
  clientOnly: boolean;
}

export interface ProjectLink {
  kind: 'website' | 'source' | 'issues' | 'wiki' | 'discord';
  url: string;
}

export interface ModProject extends ModSummary {
  body: string;
  bodyFormat: 'markdown' | 'html';
  links: ProjectLink[];
  license: string | null;
}

export interface ModVersionFile {
  /** `null` when the file can only be downloaded on CurseForge's website. */
  url: string | null;
  filename: string;
  size: number;
  sha1: string | null;
  sha512: string | null;
  /** CurseForge (murmur2) fingerprint. */
  fingerprint: number | null;
}

export interface ModDependency {
  projectId: string | null;
  versionId: string | null;
  relation: DependencyRelation;
}

export interface ModVersion {
  source: ModSource;
  id: string;
  projectId: string;
  name: string;
  versionNumber: string;
  channel: Channel;
  loaders: string[];
  gameVersions: string[];
  published: string;
  downloads: number;
  /** The jar to install; `null` when the version has no usable jar. */
  file: ModVersionFile | null;
  /** The file can be pulled straight from the source's CDN. */
  downloadable: boolean;
  clientOnly: boolean;
  dependencies: ModDependency[];
}

export const fromModrinthHit = (hit: modrinth.ModrinthSearchHit): ModSummary => ({
  source: 'modrinth',
  id: hit.project_id,
  slug: hit.slug,
  title: hit.title,
  description: hit.description,
  author: hit.author,
  iconUrl: hit.icon_url,
  downloads: hit.downloads,
  follows: hit.follows,
  categories: hit.display_categories,
  loaders: hit.display_categories,
  updated: hit.date_modified,
  url: `https://modrinth.com/mod/${hit.slug}`,
  clientOnly: hit.server_side === 'unsupported',
});

export const fromModrinthProject = (project: modrinth.ModrinthProject, author = ''): ModProject => ({
  source: 'modrinth',
  id: project.id,
  slug: project.slug,
  title: project.title,
  description: project.description,
  author,
  iconUrl: project.icon_url,
  downloads: project.downloads,
  follows: project.followers,
  categories: project.categories,
  loaders: project.loaders,
  updated: project.updated,
  url: `https://modrinth.com/mod/${project.slug}`,
  clientOnly: project.server_side === 'unsupported',
  body: project.body,
  bodyFormat: 'markdown',
  license: project.license ? project.license.name || project.license.id : null,
  links: (
    [
      ['source', project.source_url],
      ['issues', project.issues_url],
      ['wiki', project.wiki_url],
      ['discord', project.discord_url],
    ] as const
  ).flatMap(([kind, url]) => {
    const safe = safeLink(url);
    return safe ? [{ kind, url: safe }] : [];
  }),
});

/** The primary jar of a Modrinth version; never a sources jar or another file type. */
function modrinthJar(version: modrinth.ModrinthVersion): modrinth.ModrinthVersionFile | undefined {
  const jars = version.files.filter((file) => isSafeJarName(file.filename));
  return jars.find((file) => file.primary) ?? (jars.length === 1 ? jars[0] : undefined);
}

export function fromModrinthVersion(version: modrinth.ModrinthVersion): ModVersion {
  const jar = modrinthJar(version);

  return {
    source: 'modrinth',
    id: version.id,
    projectId: version.project_id,
    name: version.name,
    versionNumber: version.version_number,
    channel: version.version_type,
    loaders: version.loaders,
    gameVersions: version.game_versions,
    published: version.date_published,
    downloads: version.downloads,
    file: jar
      ? {
          url: jar.url,
          filename: jar.filename,
          size: jar.size,
          sha1: jar.hashes.sha1?.toLowerCase() ?? null,
          sha512: jar.hashes.sha512?.toLowerCase() ?? null,
          fingerprint: null,
        }
      : null,
    downloadable: !!jar && isAllowedDownload('modrinth', jar.url),
    clientOnly: false,
    dependencies: (version.dependencies ?? []).flatMap((dependency) =>
      dependency.dependency_type === 'embedded'
        ? []
        : [
            {
              projectId: dependency.project_id,
              versionId: dependency.version_id,
              relation: dependency.dependency_type,
            },
          ],
    ),
  };
}

export const sortNewestFirst = <T extends { published: string }>(versions: T[]): T[] =>
  [...versions].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
