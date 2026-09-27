import { faCompass, faCubes } from '@fortawesome/free-solid-svg-icons';
import SubNavigation from '@/elements/navigation/SubNavigation.tsx';
import { useServerStore } from '@/stores/server.ts';
import { serverModsPath } from '../lib/constants.ts';
import { useExtTranslations } from '../translations.ts';

export default function ModsSubNavigation() {
  const { t: tExt } = useExtTranslations();
  const uuidShort = useServerStore((state) => state.server.uuidShort);

  return (
    <SubNavigation
      baseUrl={serverModsPath(uuidShort)}
      items={[
        {
          name: tExt('pages.server.mods.tabs.installed', {}),
          icon: faCubes,
          link: serverModsPath(uuidShort),
        },
        {
          name: tExt('pages.server.mods.tabs.browse', {}),
          icon: faCompass,
          link: serverModsPath(uuidShort, '/browse'),
        },
      ]}
    />
  );
}
