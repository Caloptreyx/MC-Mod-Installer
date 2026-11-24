import { z } from 'zod';
import { axiosInstance } from '@/api/axios.ts';
import { parseFromApi, parsePaginationFromApi } from '@/lib/serialization/api-transform.ts';
import type { ModProject, ModSummary, ModVersion } from '../lib/catalog.ts';
import { safeLink } from '../lib/files.ts';

// CurseForge needs an API key, so it is reached through this extension's backend, which keeps
// the key and returns normalized data.

const base = (serverUuid: string) => `/api/client/servers/${serverUuid}/mod-installer/curseforge`;

export type CurseforgeSort = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';

const summarySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  author: z.string(),
  iconUrl: z.string().nullable(),
  downloads: z.number(),
  follows: z.number(),
  categories: z.array(z.string()),
  updated: z.string().nullable(),
  url: z.string(),
  gameVersions: z.array(z.string()),
  loaders: z.array(z.string()),
});

const projectSchema = z.object({
  summary: summarySchema,
  body: z.string(),
  links: z.array(z.object({ kind: z.enum(['website', 'source', 'issues', 'wiki']), url: z.string() })),
});

const versionSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  name: z.string(),
  versionNumber: z.string(),
  channel: z.enum(['release', 'beta', 'alpha']),
  loaders: z.array(z.string()),
  gameVersions: z.array(z.string()),
  clientOnly: z.boolean(),
  downloads: z.number(),
  published: z.string(),
  downloadable: z.boolean(),
  file: z.object({
    url: z.string().nullable(),
    filename: z.string(),
    size: z.number(),
    sha1: z.string().nullable(),
    fingerprint: z.number().nullable(),
  }),
  dependencies: z.array(
    z.object({ projectId: z.string(), relation: z.enum(['required', 'optional', 'incompatible']) }),
  ),
});

const categorySchema = z.object({ id: z.string(), name: z.string() });

const matchSchema = z.object({
  fingerprint: z.number(),
  project: summarySchema,
  file: versionSchema,
  update: versionSchema.nullable(),
});

const toSummary = (summary: z.infer<typeof summarySchema>): ModSummary => ({
  source: 'curseforge',
  id: summary.id,
  slug: summary.slug,
  title: summary.title,
  description: summary.description,
  author: summary.author,
  iconUrl: summary.iconUrl,
  downloads: summary.downloads,
  follows: summary.follows,
  categories: summary.categories,
  loaders: summary.loaders,
  updated: summary.updated,
  url: summary.url,
  clientOnly: false,
});

const toVersion = (version: z.infer<typeof versionSchema>): ModVersion => ({
  source: 'curseforge',
  id: version.id,
  projectId: version.projectId,
  name: version.name,
  // CurseForge's display name ("Sodium 0.6.13 (Fabric 1.21.1)") is what users know a file by.
  versionNumber: version.name,
  channel: version.channel,
  loaders: version.loaders,
  gameVersions: version.gameVersions,
  published: version.published,
  downloads: version.downloads,
  file: { ...version.file, sha512: null },
  downloadable: version.downloadable,
  clientOnly: version.clientOnly,
  dependencies: version.dependencies.map((dependency) => ({
    projectId: dependency.projectId,
    versionId: null,
    relation: dependency.relation,
  })),
});

/** Whether an administrator configured CurseForge. */
export async function getStatus(serverUuid: string): Promise<boolean> {
  const { data } = await axiosInstance.get(`${base(serverUuid)}/status`);
  return data.curseforge === true;
}

export interface CurseforgeSearchParams {
  query: string;
  loader: string | null;
  gameVersion: string | null;
  category: string | null;
  sort: CurseforgeSort;
  page: number;
  perPage: number;
}

export async function searchMods(serverUuid: string, params: CurseforgeSearchParams) {
  const { data } = await axiosInstance.get(`${base(serverUuid)}/search`, {
    params: {
      query: params.query || undefined,
      loader: params.loader ?? undefined,
      game_version: params.gameVersion ?? undefined,
      category: params.category ?? undefined,
      sort: params.sort,
      page: params.page,
      per_page: params.perPage,
    },
  });
  const page = parsePaginationFromApi(summarySchema, data.mods);
  return { total: page.total, items: page.data.map(toSummary) };
}

export async function getProject(serverUuid: string, id: string): Promise<ModProject> {
  const { data } = await axiosInstance.get(`${base(serverUuid)}/projects/${encodeURIComponent(id)}`);
  const project = parseFromApi(projectSchema, data.project);
  return {
    ...toSummary(project.summary),
    body: project.body,
    bodyFormat: 'html',
    license: null,
    links: project.links.flatMap((link) => {
      const url = safeLink(link.url);
      return url ? [{ kind: link.kind, url }] : [];
    }),
  };
}

export async function getSummaries(serverUuid: string, ids: string[]): Promise<ModSummary[]> {
  if (ids.length === 0) return [];
  const { data } = await axiosInstance.get(`${base(serverUuid)}/summaries`, { params: { ids: ids.join(',') } });
  return data.projects.map((project: unknown) => toSummary(parseFromApi(summarySchema, project)));
}

/** Files of a mod, newest first, optionally for any of `loaders` and one Minecraft version. */
export async function getProjectFiles(
  serverUuid: string,
  id: string,
  filter: { loaders?: string[]; gameVersion?: string | null } = {},
): Promise<ModVersion[]> {
  const { data } = await axiosInstance.get(`${base(serverUuid)}/projects/${encodeURIComponent(id)}/files`, {
    params: {
      loaders: filter.loaders?.length ? filter.loaders.join(',') : undefined,
      game_version: filter.gameVersion ?? undefined,
    },
  });
  return data.files.map((file: unknown) => toVersion(parseFromApi(versionSchema, file)));
}

export async function getCategories(serverUuid: string) {
  const { data } = await axiosInstance.get(`${base(serverUuid)}/categories`);
  return data.categories.map((category: unknown) => parseFromApi(categorySchema, category)) as {
    id: string;
    name: string;
  }[];
}

export interface CurseforgeMatch {
  project: ModSummary;
  file: ModVersion;
  update: ModVersion | null;
}

/**
 * Identifies jars by CurseForge fingerprint (at most 500 per call). With `loaders` and
 * `gameVersion`, matches carry the newest release for them when it is newer.
 */
export async function identifyByFingerprints(
  serverUuid: string,
  fingerprints: number[],
  loaders: string[],
  gameVersion: string | null,
): Promise<{ matches: Map<number, CurseforgeMatch>; dependencies: ModSummary[] }> {
  const matches = new Map<number, CurseforgeMatch>();
  const dependencies: ModSummary[] = [];
  for (let start = 0; start < fingerprints.length; start += 500) {
    const { data } = await axiosInstance.post(`${base(serverUuid)}/fingerprints`, {
      fingerprints: fingerprints.slice(start, start + 500),
      loaders,
      game_version: gameVersion ?? undefined,
    });
    for (const raw of data.matches) {
      const match = parseFromApi(matchSchema, raw);
      matches.set(match.fingerprint, {
        project: toSummary(match.project),
        file: toVersion(match.file),
        update: match.update ? toVersion(match.update) : null,
      });
    }
    for (const raw of data.dependencies) {
      dependencies.push(toSummary(parseFromApi(summarySchema, raw)));
    }
  }
  return { matches, dependencies };
}
