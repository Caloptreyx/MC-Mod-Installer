import { faCheck, faDownload, faMagnifyingGlass, faRightLeft } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Center } from '@mantine/core';
import { useEffect, useMemo, useState } from 'react';
import Button from '@/elements/buttons/Button.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import Table, { TableData, TableRow } from '@/elements/data-display/Table.tsx';
import Select from '@/elements/input/Select.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Group from '@/elements/layout/Group.tsx';
import Tooltip from '@/elements/overlays/Tooltip.tsx';
import FormattedTimestamp from '@/elements/time/FormattedTimestamp.tsx';
import Code from '@/elements/typography/Code.tsx';
import Text from '@/elements/typography/Text.tsx';
import type { ModrinthVersion, ModrinthVersionType } from '../../api/modrinth.ts';
import ChannelBadge from '../../components/ChannelBadge.tsx';
import LoaderBadge from '../../components/LoaderBadge.tsx';
import { useGameVersions } from '../../hooks/useGameVersions.ts';
import type { InstalledMod } from '../../hooks/useInstalledMods.ts';
import { loaderLabel } from '../../lib/constants.ts';
import type { ServerEnvironment } from '../../lib/schemas.ts';
import { formatCount, matchesFilter } from '../../lib/versions.ts';
import { useExtTranslations } from '../../translations.ts';

const PER_PAGE = 15;
const ALL = 'all';
const CHANNELS: ModrinthVersionType[] = ['release', 'beta', 'alpha'];
const VISIBLE_GAME_VERSIONS = 3;

export default function ModVersionsTab({
  versions,
  loading,
  error,
  environment,
  installed,
  canInstall,
  onInstall,
}: {
  versions: ModrinthVersion[] | undefined;
  loading: boolean;
  error: string | null;
  environment: ServerEnvironment | undefined;
  installed: InstalledMod | null;
  canInstall: boolean;
  onInstall: (version: ModrinthVersion) => void;
}) {
  const { t: tExt } = useExtTranslations();
  const { compare } = useGameVersions();

  const loaders = useMemo(
    () => [...new Set((versions ?? []).flatMap((version) => version.loaders))].sort(),
    [versions],
  );
  const gameVersions = useMemo(
    () => [...new Set((versions ?? []).flatMap((version) => version.game_versions))].sort(compare),
    [versions, compare],
  );

  const [search, setSearch] = useState('');
  const [loader, setLoader] = useState<string | null>(null);
  const [gameVersion, setGameVersion] = useState<string | null>(null);
  const [channel, setChannel] = useState<string>(ALL);
  const [page, setPage] = useState(1);

  // Default the filters to the detected environment when the mod supports it.
  useEffect(() => {
    if (!versions || loader !== null) return;

    setLoader(environment?.loader && loaders.includes(environment.loader) ? environment.loader : ALL);
    setGameVersion(
      environment?.minecraftVersion && gameVersions.includes(environment.minecraftVersion)
        ? environment.minecraftVersion
        : ALL,
    );
  }, [versions, environment]);

  useEffect(() => setPage(1), [search, loader, gameVersion, channel]);

  const needle = search.trim().toLowerCase();
  const filtered = (versions ?? []).filter(
    (version) =>
      matchesFilter(version, {
        loader: loader === ALL ? null : loader,
        gameVersion: gameVersion === ALL ? null : gameVersion,
      }) &&
      (channel === ALL || version.version_type === channel) &&
      (!needle || version.name.toLowerCase().includes(needle) || version.version_number.toLowerCase().includes(needle)),
  );
  const pageItems = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  return (
    <>
      <Group mb='md' grow align='flex-end'>
        <TextInput
          label={tExt('pages.server.mods.details.versions.search', {})}
          placeholder={tExt('pages.server.mods.details.versions.searchPlaceholder', {})}
          leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
        <Select
          label={tExt('pages.server.mods.details.versions.loader', {})}
          data={[
            { value: ALL, label: tExt('pages.server.mods.loaders.any', {}) },
            ...loaders.map((value) => ({ value, label: loaderLabel(value) })),
          ]}
          value={loader}
          onChange={(value) => setLoader(value ?? ALL)}
        />
        <Select
          label={tExt('pages.server.mods.details.versions.gameVersion', {})}
          data={[{ value: ALL, label: tExt('pages.server.mods.gameVersions.any', {}) }, ...gameVersions]}
          value={gameVersion}
          onChange={(value) => setGameVersion(value ?? ALL)}
          searchable
        />
        <Select
          label={tExt('pages.server.mods.details.versions.channel', {})}
          data={[
            { value: ALL, label: tExt('pages.server.mods.details.versions.allChannels', {}) },
            ...CHANNELS.map((value) => ({ value, label: tExt(`pages.server.mods.channel.${value}`, {}) })),
          ]}
          value={channel}
          onChange={(value) => setChannel(value ?? ALL)}
        />
      </Group>

      <Table
        columns={[
          tExt('pages.server.mods.details.versions.columns.version', {}),
          tExt('pages.server.mods.details.versions.columns.channel', {}),
          tExt('pages.server.mods.details.versions.columns.loaders', {}),
          tExt('pages.server.mods.details.versions.columns.gameVersions', {}),
          tExt('pages.server.mods.details.versions.columns.published', {}),
          tExt('pages.server.mods.details.versions.columns.downloads', {}),
          '',
        ]}
        loading={loading}
        error={error}
        pagination={{ total: filtered.length, perPage: PER_PAGE, page, data: pageItems }}
        onPageSelect={setPage}
        empty={
          <Center py='lg'>
            <Text c='dimmed'>{tExt('pages.server.mods.details.versions.empty', {})}</Text>
          </Center>
        }
      >
        {pageItems.map((version) => {
          const isInstalled = installed?.version?.id === version.id;
          const sortedGameVersions = [...version.game_versions].sort(compare);
          const hiddenGameVersions = sortedGameVersions.length - VISIBLE_GAME_VERSIONS;

          return (
            <TableRow key={version.id}>
              <TableData>
                <Text fw={600} truncate maw={280}>
                  {version.name}
                </Text>
                <Code>{version.version_number}</Code>
              </TableData>
              <TableData>
                <ChannelBadge channel={version.version_type} />
              </TableData>
              <TableData>
                <Group gap={4} wrap='nowrap'>
                  {version.loaders.map((versionLoader) => (
                    <LoaderBadge key={versionLoader} loader={versionLoader} />
                  ))}
                </Group>
              </TableData>
              <TableData>
                <Group gap={4} wrap='nowrap'>
                  <Text size='sm'>{sortedGameVersions.slice(0, VISIBLE_GAME_VERSIONS).join(', ')}</Text>
                  {hiddenGameVersions > 0 && (
                    <Tooltip label={sortedGameVersions.join(', ')} multiline maw={320}>
                      <Badge variant='default'>+{hiddenGameVersions}</Badge>
                    </Tooltip>
                  )}
                </Group>
              </TableData>
              <TableData>
                <FormattedTimestamp timestamp={version.date_published} />
              </TableData>
              <TableData>{formatCount(version.downloads)}</TableData>
              <TableData>
                {isInstalled ? (
                  <Badge color='green' variant='light' leftSection={<FontAwesomeIcon icon={faCheck} />}>
                    {tExt('pages.server.mods.details.versions.current', {})}
                  </Badge>
                ) : (
                  canInstall && (
                    <Button
                      size='xs'
                      variant={installed ? 'light' : 'filled'}
                      leftSection={<FontAwesomeIcon icon={installed ? faRightLeft : faDownload} />}
                      onClick={() => onInstall(version)}
                    >
                      {installed
                        ? tExt('pages.server.mods.button.switchVersion', {})
                        : tExt('pages.server.mods.button.install', {})}
                    </Button>
                  )
                )}
              </TableData>
            </TableRow>
          );
        })}
      </Table>
    </>
  );
}
