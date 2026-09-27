import axios from 'axios';

const modrinth = axios.create({
  baseURL: 'https://api.modrinth.com/v2',
  timeout: 20_000,
});

export type ModrinthSideSupport = 'required' | 'optional' | 'unsupported' | 'unknown';
export type ModrinthVersionType = 'release' | 'beta' | 'alpha';
export type ModrinthSearchIndex = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';

export interface ModrinthSearchHit {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  icon_url: string | null;
  downloads: number;
  follows: number;
  categories: string[];
  display_categories: string[];
  versions: string[];
  date_modified: string;
  server_side: ModrinthSideSupport;
}

export interface ModrinthSearchResult {
  hits: ModrinthSearchHit[];
  offset: number;
  limit: number;
  total_hits: number;
}

export interface ModrinthProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  project_type: string;
  categories: string[];
  loaders: string[];
  game_versions: string[];
  client_side: ModrinthSideSupport;
  server_side: ModrinthSideSupport;
  downloads: number;
  followers: number;
  icon_url: string | null;
  published: string;
  updated: string;
  license: { id: string; name: string; url: string | null } | null;
  source_url: string | null;
  issues_url: string | null;
  wiki_url: string | null;
  discord_url: string | null;
}

export interface ModrinthVersionFile {
  url: string;
  filename: string;
  primary: boolean;
  size: number;
  hashes: { sha1?: string; sha512?: string };
}

export interface ModrinthVersion {
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  version_type: ModrinthVersionType;
  loaders: string[];
  game_versions: string[];
  date_published: string;
  downloads: number;
  files: ModrinthVersionFile[];
}

export interface ModrinthTeamMember {
  role: string;
  is_owner?: boolean;
  user: { username: string };
}

export interface ModrinthGameVersion {
  version: string;
  version_type: 'release' | 'snapshot' | 'alpha' | 'beta';
  date: string;
}

export interface SearchModsOptions {
  query: string;
  loader: string | null;
  gameVersion: string | null;
  serverSideOnly: boolean;
  index: ModrinthSearchIndex;
  offset: number;
  limit: number;
}

export async function searchMods(options: SearchModsOptions): Promise<ModrinthSearchResult> {
  const facets: string[][] = [['project_type:mod']];
  if (options.loader) facets.push([`categories:${options.loader}`]);
  if (options.gameVersion) facets.push([`versions:${options.gameVersion}`]);
  if (options.serverSideOnly) facets.push(['server_side:required', 'server_side:optional']);

  const { data } = await modrinth.get<ModrinthSearchResult>('/search', {
    params: {
      query: options.query || undefined,
      facets: JSON.stringify(facets),
      index: options.index,
      offset: options.offset,
      limit: options.limit,
    },
  });
  return data;
}

export async function getProject(idOrSlug: string): Promise<ModrinthProject> {
  const { data } = await modrinth.get<ModrinthProject>(`/project/${encodeURIComponent(idOrSlug)}`);
  return data;
}

export async function getProjects(ids: string[]): Promise<ModrinthProject[]> {
  if (ids.length === 0) return [];

  const { data } = await modrinth.get<ModrinthProject[]>('/projects', { params: { ids: JSON.stringify(ids) } });
  return data;
}

export async function getProjectMembers(idOrSlug: string): Promise<ModrinthTeamMember[]> {
  const { data } = await modrinth.get<ModrinthTeamMember[]>(`/project/${encodeURIComponent(idOrSlug)}/members`);
  return data;
}

export async function getProjectVersions(idOrSlug: string): Promise<ModrinthVersion[]> {
  const { data } = await modrinth.get<ModrinthVersion[]>(`/project/${encodeURIComponent(idOrSlug)}/version`, {
    params: { include_changelog: false },
  });
  return data;
}

/** Looks up versions by the SHA-1 hash of one of their files. Unknown hashes are absent from the result. */
export async function getVersionsByHashes(hashes: string[]): Promise<Record<string, ModrinthVersion>> {
  if (hashes.length === 0) return {};

  const { data } = await modrinth.post<Record<string, ModrinthVersion>>('/version_files', {
    hashes,
    algorithm: 'sha1',
  });
  return data;
}

export async function getGameVersions(): Promise<ModrinthGameVersion[]> {
  const { data } = await modrinth.get<ModrinthGameVersion[]>('/tag/game_version');
  return data;
}
