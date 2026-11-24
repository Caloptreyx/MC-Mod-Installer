import { faCubes, faSliders } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { ReactNode, useState } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import ServerContentContainer from '@/elements/containers/ServerContentContainer.tsx';
import EmptyState from '@/elements/feedback/EmptyState.tsx';
import Group from '@/elements/layout/Group.tsx';
import type { ServerEnvironment } from '../lib/schemas.ts';
import { useModEnvironment } from '../hooks/useModEnvironment.ts';
import { loaderLabel } from '../lib/constants.ts';
import { useExtTranslations } from '../translations.ts';
import EnvironmentAlert from './EnvironmentAlert.tsx';
import ModsSubNavigation from './ModsSubNavigation.tsx';
import ServerSoftwareModal from './ServerSoftwareModal.tsx';
import SoftwareBadges from './SoftwareBadges.tsx';

/** Plugin, proxy and vanilla servers (and non-Minecraft servers) don't load mods. */
export const runsModLoader = (environment: ServerEnvironment) =>
  environment.minecraft && !['plugins', 'proxy', 'vanilla'].includes(environment.family ?? '');

/**
 * Shared chrome of the Installed and Browse pages: title, detection badges, tabs and detection alert.
 * Servers that don't run a mod loader get a short explanation instead of the pages.
 */
export default function ModsPageLayout({ contentRight, children }: { contentRight?: ReactNode; children: ReactNode }) {
  const { t: tExt } = useExtTranslations();
  const { environment, loading } = useModEnvironment();
  const [softwareOpen, setSoftwareOpen] = useState(false);

  const modded = !environment || runsModLoader(environment);

  return (
    <ServerContentContainer
      title={tExt('pages.server.mods.title', {})}
      contentRight={
        <Group gap='sm'>
          <SoftwareBadges environment={environment} loading={loading} onOpen={() => setSoftwareOpen(true)} />
          {modded && contentRight}
        </Group>
      }
    >
      <ServerSoftwareModal opened={softwareOpen} onClose={() => setSoftwareOpen(false)} />
      {modded ? (
        <>
          <ModsSubNavigation />
          <EnvironmentAlert environment={environment} />
          {children}
        </>
      ) : (
        <EmptyState
          icon={faCubes}
          title={
            environment.minecraft
              ? tExt('pages.server.mods.notModded.title', {})
              : tExt('pages.server.mods.notModded.notMinecraftTitle', {})
          }
          description={
            environment.minecraft && environment.software
              ? tExt('pages.server.mods.notModded.description', { software: loaderLabel(environment.software.value) })
              : tExt('pages.server.mods.notModded.notMinecraft', {})
          }
        >
          <Button
            variant='default'
            leftSection={<FontAwesomeIcon icon={faSliders} />}
            onClick={() => setSoftwareOpen(true)}
          >
            {tExt('pages.server.mods.notModded.details', {})}
          </Button>
        </EmptyState>
      )}
    </ServerContentContainer>
  );
}
