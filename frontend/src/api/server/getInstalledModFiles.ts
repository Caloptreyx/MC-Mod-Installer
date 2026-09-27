import { axiosInstance } from '@/api/axios.ts';
import { parseFromApi } from '@/lib/serialization/api-transform.ts';
import { type InstalledModFile, installedModFileSchema } from '../../lib/schemas.ts';

export default async (serverUuid: string): Promise<InstalledModFile[]> => {
  const { data } = await axiosInstance.get(`/api/client/servers/${serverUuid}/mod-installer/mods`);
  return data.mods.map((mod: unknown) => parseFromApi(installedModFileSchema, mod));
};
