import { faCube, faCubes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Skeleton } from '@mantine/core';
import Badge from '@/elements/data-display/Badge.tsx';
import Group from '@/elements/layout/Group.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import { loaderColor, loaderLabel } from '../lib/constants.ts';
import type { DetectionSource, ServerEnvironment } from '../lib/schemas.ts';
import { useExtTranslations } from '../translations.ts';

export default function EnvironmentBadges({
  environment,
  loading,
}: {
  environment: ServerEnvironment | undefined;
  loading: boolean;
}) {
  const { t: tExt } = useExtTranslations();

  if (loading) {
    return (
      <Group gap='xs'>
        <Skeleton height={22} width={80} radius='xl' />
        <Skeleton height={22} width={110} radius='xl' />
      </Group>
    );
  }

  if (!environment) return null;

  const sourceLabel = (source: DetectionSource | null) =>
    source
      ? tExt('pages.server.mods.environment.detectedFrom', {
          source: tExt(`pages.server.mods.environment.source.${source}`, {}),
        })
      : tExt('pages.server.mods.environment.notDetected', {});

  return (
    <Group gap='xs'>
      <Tooltip label={sourceLabel(environment.loaderSource)}>
        <Badge
          size='lg'
          variant='light'
          color={environment.loader ? loaderColor(environment.loader) : 'gray'}
          leftSection={<FontAwesomeIcon icon={faCubes} />}
        >
          {environment.loader
            ? loaderLabel(environment.loader)
            : tExt('pages.server.mods.environment.unknownLoader', {})}
        </Badge>
      </Tooltip>
      <Tooltip label={sourceLabel(environment.minecraftVersionSource)}>
        <Badge
          size='lg'
          variant='light'
          color={environment.minecraftVersion ? 'green' : 'gray'}
          leftSection={<FontAwesomeIcon icon={faCube} />}
        >
          {environment.minecraftVersion
            ? tExt('pages.server.mods.environment.minecraft', { version: environment.minecraftVersion })
            : tExt('pages.server.mods.environment.unknownVersion', {})}
        </Badge>
      </Tooltip>
    </Group>
  );
}
