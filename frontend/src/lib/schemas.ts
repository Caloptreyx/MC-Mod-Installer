import { z } from 'zod';
import { MOD_LOADERS, SOFTWARE } from './constants.ts';

export const detectionSourceSchema = z.enum([
  'override',
  'args',
  'log',
  'version_history',
  'marker',
  'files',
  'variables',
  'egg',
]);
export type DetectionSource = z.infer<typeof detectionSourceSchema>;

export const confidenceSchema = z.enum(['high', 'medium', 'low']);
export type Confidence = z.infer<typeof confidenceSchema>;

export const familySchema = z.enum(['mods', 'plugins', 'hybrid', 'proxy', 'vanilla']);
export type Family = z.infer<typeof familySchema>;

const softwareSchema = z.enum(SOFTWARE);

const versionFieldSchema = z.object({
  value: z.string(),
  source: detectionSourceSchema,
  confidence: confidenceSchema,
});
export type VersionField = z.infer<typeof versionFieldSchema>;

const evidenceSchema = z.object({
  source: detectionSourceSchema,
  detail: z.string(),
  software: softwareSchema.nullable(),
  minecraftVersion: z.string().nullable(),
  loaderVersion: z.string().nullable(),
  note: z.enum(['stale', 'superseded', 'invalid']).nullable(),
});
export type Evidence = z.infer<typeof evidenceSchema>;

export const serverEnvironmentSchema = z.object({
  minecraft: z.boolean(),
  software: z
    .object({
      value: softwareSchema,
      source: detectionSourceSchema,
      confidence: confidenceSchema,
    })
    .nullable(),
  family: familySchema.nullable(),
  modLoaders: z.array(z.enum(MOD_LOADERS)),
  minecraftVersion: versionFieldSchema.nullable(),
  loaderVersion: versionFieldSchema.nullable(),
  evidence: z.array(evidenceSchema),
  conflicts: z.array(evidenceSchema),
  logStale: z.boolean(),
  override: z
    .object({
      software: softwareSchema,
      minecraftVersion: z.string().nullable(),
      loaderVersion: z.string().nullable(),
      setAt: z.string().nullable(),
    })
    .nullable(),
});
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export const installedModFileSchema = z.object({
  fileName: z.string(),
  enabled: z.boolean(),
  size: z.number(),
  modified: z.coerce.date(),
  sha1: z.string().nullable(),
  fingerprint: z.number().nullable(),
  tooLarge: z.boolean(),
});
export type InstalledModFile = z.infer<typeof installedModFileSchema>;

export const packMarkerSchema = z.object({
  name: z.string().nullable(),
  versionName: z.string().nullable(),
  source: z.string().nullable(),
  projectId: z.string().nullable(),
  installedAt: z.string().nullable(),
  files: z
    .array(
      z.object({
        path: z.string(),
        sha1: z.string().nullable(),
        source: z.string().nullable(),
        projectId: z.string().nullable(),
        fileId: z.string().nullable(),
      }),
    )
    .nullable(),
});
export type PackMarker = z.infer<typeof packMarkerSchema>;
