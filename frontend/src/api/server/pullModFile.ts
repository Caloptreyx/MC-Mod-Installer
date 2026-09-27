import { axiosInstance } from '@/api/axios.ts';
import { MODS_ROOT } from '../../lib/constants.ts';

/**
 * Downloads `url` into the server's mods directory as `name`.
 * Runs in the foreground so the request only resolves once the file is fully written.
 */
export default async (serverUuid: string, url: string, name: string): Promise<void> => {
  await axiosInstance.post(`/api/client/servers/${serverUuid}/files/pull`, {
    root: MODS_ROOT,
    url,
    name,
    foreground: true,
  });
};
