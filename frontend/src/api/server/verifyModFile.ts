import { axiosInstance } from '@/api/axios.ts';

export type VerifyAlgorithm = 'sha1' | 'sha512' | 'curseforge';

/** Whether the hash of `mods/<file>` on the server equals `expected`. */
export default async (
  serverUuid: string,
  file: string,
  algorithm: VerifyAlgorithm,
  expected: string,
): Promise<boolean> => {
  const { data } = await axiosInstance.post(`/api/client/servers/${serverUuid}/mod-installer/verify`, {
    file,
    algorithm,
    expected,
  });
  return data.matches === true;
};
