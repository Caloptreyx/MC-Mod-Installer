import { faCube, faCubes } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Skeleton, UnstyledButton } from '@mantine/core';
import Badge from '@/elements/data-display/Badge.tsx';
import Group from '@/elements/layout/Group.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import type { ServerEnvironment, VersionField } from '../lib/schemas.ts';
import { loaderColor, loaderLabel } from '../lib/constants.ts';
import { useExtTranslations } from '../translations.ts';

/** Detected software and Minecraft version; a click opens the "Server software" panel. */
export default function SoftwareBadges({
  environment,
  loading,
  onOpen,
}: {
  environment: ServerEnvironment | undefined;
  loading: boolean;
  onOpen: () => void;
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

  const sourceLabel = (field: { source: VersionField['source'] } | null) =>
    field
      ? tExt('pages.server.mods.environment.detectedFrom', {
          source: tExt(`pages.server.mods.environment.source.${field.source}`, {}),
        })
      : tExt('pages.server.mods.environment.notDetected', {});
  const software = environment.software?.value;

  return (
    <UnstyledButton onClick={onOpen} aria-label={tExt('pages.server.mods.environment.title', {})}>
      <Group gap='xs'>
        <Tooltip label={sourceLabel(environment.software)}>
          <Badge
            size='lg'
            variant='light'
            color={software ? loaderColor(software) : 'gray'}
            leftSection={<FontAwesomeIcon icon={faCubes} />}
          >
            {software ? loaderLabel(software) : tExt('pages.server.mods.environment.unknownLoader', {})}
            {environment.loaderVersion ? ` ${environment.loaderVersion.value}` : ''}
          </Badge>
        </Tooltip>
        {environment.family !== 'proxy' && (
          <Tooltip label={sourceLabel(environment.minecraftVersion)}>
            <Badge
              size='lg'
              variant='light'
              color={environment.minecraftVersion ? 'green' : 'gray'}
              leftSection={<FontAwesomeIcon icon={faCube} />}
            >
              {environment.minecraftVersion
                ? tExt('pages.server.mods.environment.minecraft', { version: environment.minecraftVersion.value })
                : tExt('pages.server.mods.environment.unknownVersion', {})}
            </Badge>
          </Tooltip>
        )}
        {(environment.conflicts.length > 0 || environment.logStale) && (
          <Badge size='lg' variant='light' color='yellow'>
            !
          </Badge>
        )}
      </Group>
    </UnstyledButton>
  );
}
