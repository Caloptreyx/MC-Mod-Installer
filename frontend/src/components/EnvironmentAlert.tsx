import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Alert from '@/elements/feedback/Alert.tsx';
import type { ServerEnvironment } from '../lib/schemas.ts';
import { useExtTranslations } from '../translations.ts';

/** Warns when the mod loader and/or Minecraft version of the server could not be detected. */
export default function EnvironmentAlert({ environment }: { environment: ServerEnvironment | undefined }) {
  const { t: tExt } = useExtTranslations();

  if (!environment || (environment.loader && environment.minecraftVersion)) return null;

  const missing =
    !environment.loader && !environment.minecraftVersion ? 'both' : environment.loader ? 'version' : 'loader';

  return (
    <Alert
      color='yellow'
      icon={<FontAwesomeIcon icon={faTriangleExclamation} />}
      title={tExt(`pages.server.mods.environment.alert.title.${missing}`, {})}
      mb='md'
    >
      {tExt('pages.server.mods.environment.alert.content', {})}
    </Alert>
  );
}
