import { ReactNode } from 'react';
import ServerContentContainer from '@/elements/containers/ServerContentContainer.tsx';
import Group from '@/elements/layout/Group.tsx';
import { useModEnvironment } from '../hooks/useModEnvironment.ts';
import { useExtTranslations } from '../translations.ts';
import EnvironmentAlert from './EnvironmentAlert.tsx';
import EnvironmentBadges from './EnvironmentBadges.tsx';
import ModsSubNavigation from './ModsSubNavigation.tsx';

/** Shared chrome of the Installed and Browse pages: title, detection badges, tabs and detection alert. */
export default function ModsPageLayout({ contentRight, children }: { contentRight?: ReactNode; children: ReactNode }) {
  const { t: tExt } = useExtTranslations();
  const { environment, loading } = useModEnvironment();

  return (
    <ServerContentContainer
      title={tExt('pages.server.mods.title', {})}
      contentRight={
        <Group gap='sm'>
          <EnvironmentBadges environment={environment} loading={loading} />
          {contentRight}
        </Group>
      }
    >
      <ModsSubNavigation />
      <EnvironmentAlert environment={environment} />
      {children}
    </ServerContentContainer>
  );
}
