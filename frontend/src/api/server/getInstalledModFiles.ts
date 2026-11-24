import { axiosInstance } from '@/api/axios.ts';
import { parseFromApi } from '@/lib/serialization/api-transform.ts';
import { type InstalledModFile, installedModFileSchema, type PackMarker, packMarkerSchema } from '../../lib/schemas.ts';

export interface InstalledModFiles {
  mods: InstalledModFile[];
  /** The modpack marker in the server root, when present and readable. */
  pack: PackMarker | null;
}

export default async (serverUuid: string): Promise<InstalledModFiles> => {
  const { data } = await axiosInstance.get(`/api/client/servers/${serverUuid}/mod-installer/mods`);
  return {
    mods: data.mods.map((mod: unknown) => parseFromApi(installedModFileSchema, mod)),
    pack: data.pack ? parseFromApi(packMarkerSchema, data.pack) : null,
  };
};
