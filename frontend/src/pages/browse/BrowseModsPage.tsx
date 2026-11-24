import { faMagnifyingGlass } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { SimpleGrid } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
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
import SegmentedControl from '@/elements/layout/SegmentedControl.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useServerStore } from '@/stores/server.ts';
import * as curseforgeApi from '../../api/curseforge.ts';
import { type ModrinthSearchIndex, searchMods } from '../../api/modrinth.ts';
import InstallModModal, { type InstallModProject } from '../../components/InstallModModal.tsx';
import ModsPageLayout from '../../components/ModsPageLayout.tsx';
import { useCurseforgeStatus } from '../../hooks/useCurseforgeStatus.ts';
import { useGameVersions } from '../../hooks/useGameVersions.ts';
import { useInstalledMods } from '../../hooks/useInstalledMods.ts';
import { useModEnvironment } from '../../hooks/useModEnvironment.ts';
import { fromModrinthHit, type ModSummary } from '../../lib/catalog.ts';
import { loaderLabel, MOD_LOADERS, type ModSource, modInstallerQueryKey, projectPath } from '../../lib/constants.ts';
import { useExtTranslations } from '../../translations.ts';
import ModCard from './ModCard.tsx';

const PER_PAGE = 20;
/** Both sources refuse offsets past this many results. */
const MAX_RESULTS = 10_000;
const ANY = 'any';
/** The loaders the server loads (Quilt also loads Fabric mods). */
const SERVER = 'server';
const SORT_OPTIONS: ModrinthSearchIndex[] = ['relevance', 'downloads', 'follows', 'newest', 'updated'];

export default function BrowseModsPage() {
  const { t: tExt } = useExtTranslations();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const server = useServerStore((state) => state.server);
  const canInstall = useServerCan('files.create');
  const curseforge = useCurseforgeStatus();

  const { loading: environmentLoading, serverLoaders, minecraftVersion } = useModEnvironment();
  const { releases } = useGameVersions();
  const { installedProject } = useInstalledMods();

  // Filters live in the URL, so a search can be shared and survives the details page.
  const source: ModSource = params.get('source') === 'curseforge' && curseforge ? 'curseforge' : 'modrinth';
  const loader = params.get('loader') ?? (serverLoaders.length > 0 ? SERVER : ANY);
  const gameVersion = params.get('version') ?? minecraftVersion ?? ANY;
  const sort = (params.get('sort') as ModrinthSearchIndex | null) ?? 'relevance';
  const category = params.get('category');
  const serverSideOnly = params.get('serverside') !== '0';
  const page = Math.max(1, Number(params.get('page')) || 1);

  const [query, setQuery] = useState(params.get('q') ?? '');
  const [debouncedQuery] = useDebouncedValue(query, 300);
  const [installTarget, setInstallTarget] = useState<ModSummary | null>(null);

  const update = (changes: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null) next.delete(key);
          else next.set(key, value);
        }
        // Any other change starts over on the first page.
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    if (debouncedQuery !== (params.get('q') ?? '')) update({ q: debouncedQuery || null });
  }, [debouncedQuery]);

  const loaders = loader === SERVER ? serverLoaders : loader === ANY ? [] : [loader];

  const categories = useQuery({
    queryKey: modInstallerQueryKey('curseforge-categories', server.uuid),
    queryFn: () => curseforgeApi.getCategories(server.uuid),
    enabled: source === 'curseforge',
    staleTime: 60 * 60 * 1000,
  });

  const search = useQuery({
    queryKey: modInstallerQueryKey('search', {
      source,
      debouncedQuery,
      loaders,
      gameVersion,
      sort,
      category,
      serverSideOnly,
      page,
    }),
    queryFn: async (): Promise<{ total: number; items: ModSummary[] }> => {
      if (source === 'curseforge') {
        return curseforgeApi.searchMods(server.uuid, {
          query: debouncedQuery,
          // CurseForge filters by one loader; the server's own comes first.
          loader: loaders[0] ?? null,
          gameVersion: gameVersion === ANY ? null : gameVersion,
          category,
          sort,
          page,
          perPage: PER_PAGE,
        });
      }
      const result = await searchMods({
        query: debouncedQuery,
        loaders,
        gameVersion: gameVersion === ANY ? null : gameVersion,
        serverSideOnly,
        index: sort,
        offset: (page - 1) * PER_PAGE,
        limit: PER_PAGE,
      });
      return { total: result.total_hits, items: result.hits.map(fromModrinthHit) };
    },
    enabled: !environmentLoading,
    placeholderData: keepPreviousData,
  });

  const gameVersionOptions = [
    ...(minecraftVersion && !releases.includes(minecraftVersion) ? [minecraftVersion] : []),
    ...releases,
  ];

  const pagination = {
    total: Math.min(search.data?.total ?? 0, MAX_RESULTS),
    perPage: PER_PAGE,
    page,
    data: search.data?.items ?? [],
  };
  const setPage = (next: number) => update({ page: String(next) });

  const installProject: InstallModProject = {
    source: installTarget?.source ?? source,
    id: installTarget?.id ?? '',
    slug: installTarget?.slug ?? '',
    title: installTarget?.title ?? '',
    iconUrl: installTarget?.iconUrl ?? null,
  };

  return (
    <ModsPageLayout>
      <InstallModModal
        opened={!!installTarget}
        onClose={() => setInstallTarget(null)}
        project={installProject}
        installed={installTarget ? installedProject(installTarget.source, installTarget.id) : null}
      />

      <Paper withBorder p='md' radius='md' mb='md'>
        <Stack gap='sm'>
          {curseforge && (
            <SegmentedControl
              value={source}
              onChange={(value) => update({ source: value === 'curseforge' ? 'curseforge' : null, category: null })}
              data={[
                { value: 'modrinth', label: 'Modrinth' },
                { value: 'curseforge', label: 'CurseForge' },
              ]}
            />
          )}
          <TextInput
            placeholder={
              source === 'curseforge'
                ? tExt('pages.server.mods.browse.searchPlaceholderCurseforge', {})
                : tExt('pages.server.mods.browse.searchPlaceholder', {})
            }
            leftSection={<FontAwesomeIcon icon={faMagnifyingGlass} />}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <Group grow align='flex-end' wrap='wrap'>
            <Select
              label={tExt('pages.server.mods.browse.loader', {})}
              data={[
                ...(serverLoaders.length > 0
                  ? [
                      {
                        value: SERVER,
                        label: tExt('pages.server.mods.loaders.server', {
                          loaders: serverLoaders.map(loaderLabel).join(' + '),
                        }),
                      },
                    ]
                  : []),
                { value: ANY, label: tExt('pages.server.mods.loaders.any', {}) },
                ...MOD_LOADERS.map((value) => ({ value, label: loaderLabel(value) })),
              ]}
              value={loader}
              onChange={(value) => update({ loader: value ?? ANY })}
              miw={160}
            />
            <Select
              label={tExt('pages.server.mods.browse.gameVersion', {})}
              data={[{ value: ANY, label: tExt('pages.server.mods.gameVersions.any', {}) }, ...gameVersionOptions]}
              value={gameVersion}
              onChange={(value) => update({ version: value ?? ANY })}
              searchable
              miw={140}
            />
            {source === 'curseforge' && (
              <Select
                label={tExt('pages.server.mods.browse.category', {})}
                data={[
                  { value: ANY, label: tExt('pages.server.mods.browse.anyCategory', {}) },
                  ...(categories.data ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
                ]}
                value={category ?? ANY}
                onChange={(value) => update({ category: value && value !== ANY ? value : null })}
                searchable
                miw={160}
              />
            )}
            <Select
              label={tExt('pages.server.mods.browse.sort', {})}
              data={SORT_OPTIONS.map((value) => ({
                value,
                label: tExt(`pages.server.mods.browse.sortOptions.${value}`, {}),
              }))}
              value={sort}
              onChange={(value) => update({ sort: value && value !== 'relevance' ? value : null })}
              miw={140}
            />
          </Group>
          {source === 'modrinth' && (
            <Switch
              label={tExt('pages.server.mods.browse.serverSideOnly', {})}
              description={tExt('pages.server.mods.browse.serverSideOnlyDescription', {})}
              checked={serverSideOnly}
              onChange={(event) => update({ serverside: event.currentTarget.checked ? null : '0' })}
            />
          )}
        </Stack>
      </Paper>

      {search.error ? (
        <Alert color='red'>{httpErrorToHuman(search.error)}</Alert>
      ) : !search.data ? (
        <Spinner.Centered />
      ) : search.data.items.length === 0 ? (
        <EmptyState
          icon={faMagnifyingGlass}
          title={tExt('pages.server.mods.browse.empty.title', {})}
          description={tExt('pages.server.mods.browse.empty.description', {})}
        />
      ) : (
        <Stack gap='md' style={{ opacity: search.isFetching ? 0.6 : 1, transition: 'opacity 150ms' }}>
          <Pagination data={pagination} onPageSelect={setPage} />
          <SimpleGrid cols={{ base: 1, xl: 2 }} spacing='md'>
            {search.data.items.map((mod) => (
              <ModCard
                key={`${mod.source}:${mod.id}`}
                mod={mod}
                installed={installedProject(mod.source, mod.id)}
                canInstall={canInstall}
                onOpen={() =>
                  navigate(projectPath(server.uuidShort, mod.source, mod.source === 'modrinth' ? mod.slug : mod.id))
                }
                onInstall={() => setInstallTarget(mod)}
              />
            ))}
          </SimpleGrid>
          <Pagination data={pagination} onPageSelect={setPage} />
        </Stack>
      )}
    </ModsPageLayout>
  );
}
