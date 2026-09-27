import { faCheck, faDownload, faHeart, faRightLeft } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Button from '@/elements/buttons/Button.tsx';
import Avatar from '@/elements/data-display/Avatar.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import Card from '@/elements/data-display/Card.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import FormattedTimestamp from '@/elements/time/FormattedTimestamp.tsx';
import Text from '@/elements/typography/Text.tsx';
import type { ModrinthSearchHit } from '../../api/modrinth.ts';
import LoaderBadge from '../../components/LoaderBadge.tsx';
import type { InstalledMod } from '../../hooks/useInstalledMods.ts';
import { isModLoader } from '../../lib/constants.ts';
import { formatCount } from '../../lib/versions.ts';
import { useExtTranslations } from '../../translations.ts';

export default function ModCard({
  hit,
  installed,
  canInstall,
  onOpen,
  onInstall,
}: {
  hit: ModrinthSearchHit;
  installed: InstalledMod | null;
  canInstall: boolean;
  onOpen: () => void;
  onInstall: () => void;
}) {
  const { t: tExt } = useExtTranslations();

  const loaders = hit.display_categories.filter(isModLoader);
  const categories = hit.display_categories.filter((category) => !isModLoader(category)).slice(0, 3);

  return (
    <Card hoverable p='md' onClick={onOpen}>
      <Group wrap='nowrap' align='flex-start' gap='md'>
        <Avatar src={hit.icon_url} name={hit.title} size={64} radius='md' />

        <Stack gap={6} style={{ flex: 1, minWidth: 0 }}>
          <Group justify='space-between' wrap='nowrap' align='flex-start'>
            <div style={{ minWidth: 0 }}>
              <Text fw={600} size='lg' truncate>
                {hit.title}
              </Text>
              <Text size='xs' c='dimmed' truncate>
                {tExt('pages.server.mods.browse.by', { author: hit.author })}
              </Text>
            </div>
            {installed && (
              <Badge color='green' variant='light' leftSection={<FontAwesomeIcon icon={faCheck} />}>
                {tExt('pages.server.mods.button.installed', {})}
              </Badge>
            )}
          </Group>

          <Text size='sm' c='dimmed' lineClamp={2}>
            {hit.description}
          </Text>

          <Group gap={6}>
            {loaders.map((loader) => (
              <LoaderBadge key={loader} loader={loader} />
            ))}
            {categories.map((category) => (
              <Badge key={category} variant='default' tt='capitalize'>
                {category}
              </Badge>
            ))}
          </Group>

          <Group justify='space-between' wrap='nowrap' mt={4}>
            <Group gap='md' c='dimmed' wrap='nowrap'>
              <Text
                size='xs'
                title={tExt('pages.server.mods.browse.downloads', { count: hit.downloads.toLocaleString() })}
              >
                <FontAwesomeIcon icon={faDownload} /> {formatCount(hit.downloads)}
              </Text>
              <Text
                size='xs'
                title={tExt('pages.server.mods.browse.followers', { count: hit.follows.toLocaleString() })}
              >
                <FontAwesomeIcon icon={faHeart} /> {formatCount(hit.follows)}
              </Text>
              <Text size='xs' visibleFrom='sm'>
                {tExt('pages.server.mods.browse.updated', {})} <FormattedTimestamp timestamp={hit.date_modified} />
              </Text>
            </Group>

            {canInstall && (
              <Button
                size='xs'
                variant={installed ? 'light' : 'filled'}
                leftSection={<FontAwesomeIcon icon={installed ? faRightLeft : faDownload} />}
                onClick={(event) => {
                  event.stopPropagation();
                  onInstall();
                }}
              >
                {installed
                  ? tExt('pages.server.mods.button.switchVersion', {})
                  : tExt('pages.server.mods.button.install', {})}
              </Button>
            )}
          </Group>
        </Stack>
      </Group>
    </Card>
  );
}
