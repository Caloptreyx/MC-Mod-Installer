import { axiosInstance } from '@/api/axios.ts';
import { parseFromApi } from '@/lib/serialization/api-transform.ts';
import { type ServerEnvironment, serverEnvironmentSchema } from '../../lib/schemas.ts';

export default async (serverUuid: string): Promise<ServerEnvironment> => {
  const { data } = await axiosInstance.get(`/api/client/servers/${serverUuid}/mod-installer/environment`);
  return parseFromApi(serverEnvironmentSchema, data.environment);
};
