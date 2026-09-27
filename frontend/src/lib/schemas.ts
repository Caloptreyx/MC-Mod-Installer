import { z } from 'zod';
import { MOD_LOADERS } from './constants.ts';

export const detectionSourceSchema = z.enum(['log', 'files', 'variables', 'egg']);
export type DetectionSource = z.infer<typeof detectionSourceSchema>;

export const serverEnvironmentSchema = z.object({
  loader: z.enum(MOD_LOADERS).nullable(),
  loaderSource: detectionSourceSchema.nullable(),
  minecraftVersion: z.string().nullable(),
  minecraftVersionSource: detectionSourceSchema.nullable(),
});
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export const installedModFileSchema = z.object({
  fileName: z.string(),
  enabled: z.boolean(),
  size: z.number(),
  modified: z.coerce.date(),
  sha1: z.string().nullable(),
});
export type InstalledModFile = z.infer<typeof installedModFileSchema>;
