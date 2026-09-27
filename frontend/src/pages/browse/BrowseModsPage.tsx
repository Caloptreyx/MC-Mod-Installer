import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { SimpleGrid } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { httpErrorToHuman } from '@/api/axios.ts';
import { Pagination } from '@/elements/data-display/Table.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import EmptyState from '@/elements/feedback/EmptyState.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import Select from '@/elements/input/Select.tsx';
import Switch from '@/elements/input/Switch.tsx';
import TextInput from '@/elements/input/TextInput.tsx';
import Group from '@/elements/layout/Group.tsx';
import Paper from '@/elements/layout/Paper.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useServerStore } from '@/stores/server.ts';
import { type ModrinthSearchHit, type ModrinthSearchIndex, searchMods } from '../../api/modrinth.ts';
import InstallModModal from '../../components/InstallModModal.tsx';
import ModsPageLayout from '../../components/ModsPageLayout.tsx';
import { useGameVersions } from '../../hooks/useGameVersions.ts';
import { useInstalledMods } from '../../hooks/useInstalledMods.ts';
import { useModEnvironment } from '../../hooks/useModEnvironment.ts';
import { loaderLabel, MOD_LOADERS, modInstallerQueryKey, serverModsPath } from '../../lib/constants.ts';
import { useExtTranslations } from '../../translations.ts';
import ModCard from './ModCard.tsx';

const PER_PAGE = 20;
/** Modrinth refuses offsets past this many results. */
const MAX_RESULTS = 10_000;
const ANY = 'any';
const SORT_OPTIONS: ModrinthSearchIndex[] = ['relevance', 'downloads', 'follows', 'newest', 'updated'];

export default function BrowseModsPage() {
  const { t: tExt } = useExtTranslations();
  const navigate = useNavigate();
  const uuidShort = useServerStore((state) => state.server.uuidShort);
  const canInstall = useServerCan('files.create');

  const { environment, loading: environmentLoading } = useModEnvironment();
  const { releases } = useGameVersions();
  const { byProjectId } = useInstalledMods();

  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebouncedValue(query, 300);
  const [loader, setLoader] = useState<string | null>(null);
  const [gameVersion, setGameVersion] = useState<string | null>(null);
  const [sort, setSort] = useState<ModrinthSearchIndex>('relevance');
  const [serverSideOnly, setServerSideOnly] = useState(true);
  const [page, setPage] = useState(1);
  const [installTarget, setInstallTarget] = useState<ModrinthSearchHit | null>(null);

  // Default the filters to the detected environment once it is known.
  useEffect(() => {
    if (environmentLoading || loader !== null) return;

    setLoader(environment?.loader ?? ANY);
    setGameVersion(environment?.minecraftVersion ?? ANY);
  }, [environmentLoading]);

  const filtersReady = loader !== null && gameVersion !== null;

  const { data, isFetching, error } = useQuery({
    queryKey: modInstallerQueryKey('search', { debouncedQuery, loader, gameVersion, sort, serverSideOnly, page }),
    queryFn: () =>
      searchMods({
        query: debouncedQuery,
        loader: loader === ANY ? null : loader,
        gameVersion: gameVersion === ANY ? null : gameVersion,
        serverSideOnly,
        index: sort,
        offset: (page - 1) * PER_PAGE,
        limit: PER_PAGE,
      }),
    enabled: filtersReady,
    placeholderData: keepPreviousData,
  });

  // Jump back to the first page whenever the result set changes.
  useEffect(() => setPage(1), [debouncedQuery, loader, gameVersion, sort, serverSideOnly]);

  const gameVersionOptions = [
    ...(environment?.minecraftVersion && !releases.includes(environment.minecraftVersion)
      ? [environment.minecraftVersion]
      : []),
    ...releases,
  ];

  const pagination = {
    total: Math.min(data?.total_hits ?? 0, MAX_RESULTS),
    perPage: PER_PAGE,
    page,
    data: data?.hits ?? [],
  };

  return (
    <ModsPageLayout>
      <InstallModModal
        opened={!!installTarget}
        onClose={() => setInstallTarget(null)}
        project={{
          id: installTarget?.project_id ?? '',
          title: installTarget?.title ?? '',
          iconUrl: installTarget?.icon_url ?? null,
        }}
        installed={(installTarget && byProjectId.get(installTarget.project_id)) ?? null}
      />

      <Paper withBorder p='md' radius='md' mb='md'>
        <Stack gap='sm'>
          <TextInput
            placeholder={tExt('pages.server.mods.browse.searchPlaceholder', {})}
            leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Group grow align='flex-end'>
            <Select
              label={tExt('pages.server.mods.browse.loader', {})}
              data={[
                { value: ANY, label: tExt('pages.server.mods.loaders.any', {}) },
                ...MOD_LOADERS.map((value) => ({ value, label: loaderLabel(value) })),
              ]}
              value={loader}
              onChange={(value) => setLoader(value ?? ANY)}
            />
            <Select
              label={tExt('pages.server.mods.browse.gameVersion', {})}
              data={[{ value: ANY, label: tExt('pages.server.mods.gameVersions.any', {}) }, ...gameVersionOptions]}
              value={gameVersion}
              onChange={(value) => setGameVersion(value ?? ANY)}
              searchable
            />
            <Select
              label={tExt('pages.server.mods.browse.sort', {})}
              data={SORT_OPTIONS.map((value) => ({
                value,
                label: tExt(`pages.server.mods.browse.sortOptions.${value}`, {}),
              }))}
              value={sort}
              onChange={(value) => setSort((value as ModrinthSearchIndex | null) ?? 'relevance')}
            />
          </Group>
          <Switch
            label={tExt('pages.server.mods.browse.serverSideOnly', {})}
            description={tExt('pages.server.mods.browse.serverSideOnlyDescription', {})}
            checked={serverSideOnly}
            onChange={(event) => setServerSideOnly(event.currentTarget.checked)}
          />
        </Stack>
      </Paper>

      {error ? (
        <Alert color='red'>{httpErrorToHuman(error)}</Alert>
      ) : !data ? (
        <Spinner.Centered />
      ) : data.hits.length === 0 ? (
        <EmptyState
          icon={faMagnifyingGlass}
          title={tExt('pages.server.mods.browse.empty.title', {})}
          description={tExt('pages.server.mods.browse.empty.description', {})}
        />
      ) : (
        <Stack gap='md' style={{ opacity: isFetching ? 0.6 : 1, transition: 'opacity 150ms' }}>
          <Pagination data={pagination} onPageSelect={setPage} />
          <SimpleGrid cols={{ base: 1, xl: 2 }} spacing='md'>
            {data.hits.map((hit) => (
              <ModCard
                key={hit.project_id}
                hit={hit}
                installed={byProjectId.get(hit.project_id) ?? null}
                canInstall={canInstall}
                onOpen={() => navigate(serverModsPath(uuidShort, `/project/${hit.slug}`))}
                onInstall={() => setInstallTarget(hit)}
              />
            ))}
          </SimpleGrid>
          <Pagination data={pagination} onPageSelect={setPage} />
        </Stack>
      )}
    </ModsPageLayout>
  );
}
