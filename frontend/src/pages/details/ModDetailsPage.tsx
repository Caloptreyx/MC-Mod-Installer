import { faDiscord } from '@fortawesome/free-brands-svg-icons';
import {
  faArrowLeft,
  faArrowUpRightFromSquare,
  faBook,
  faBug,
  faCheck,
  faCode,
  faDownload,
  faGlobe,
  faRightLeft,
} from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import ServerContentContainer from '@/elements/containers/ServerContentContainer.tsx';
import Avatar from '@/elements/data-display/Avatar.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import Divider from '@/elements/layout/Divider.tsx';
import Group from '@/elements/layout/Group.tsx';
import Paper from '@/elements/layout/Paper.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import Tabs from '@/elements/layout/Tabs.tsx';
import FormattedTimestamp from '@/elements/time/FormattedTimestamp.tsx';
import Anchor from '@/elements/typography/Anchor.tsx';
import Text from '@/elements/typography/Text.tsx';
import Title from '@/elements/typography/Title.tsx';
import { useServerCan } from '@/plugins/usePermissions.ts';
import { useServerStore } from '@/stores/server.ts';
import * as curseforgeApi from '../../api/curseforge.ts';
import { getProject, getProjectMembers } from '../../api/modrinth.ts';
import InstallModModal from '../../components/InstallModModal.tsx';
import LoaderBadge from '../../components/LoaderBadge.tsx';
import ModMarkdown from '../../components/ModMarkdown.tsx';
import { useInstalledMods } from '../../hooks/useInstalledMods.ts';
import { useProjectVersions } from '../../hooks/useProjectVersions.ts';
import { fromModrinthProject, type ModProject, type ModVersion, type ProjectLink } from '../../lib/catalog.ts';
import { isModLoader, type ModSource, modInstallerQueryKey, serverModsPath } from '../../lib/constants.ts';
import { formatCount } from '../../lib/versions.ts';
import { useExtTranslations } from '../../translations.ts';
import ModVersionsTab from './ModVersionsTab.tsx';

const LINK_ICONS: Record<ProjectLink['kind'], typeof faCode> = {
  website: faGlobe,
  source: faCode,
  issues: faBug,
  wiki: faBook,
  discord: faDiscord,
};

async function loadProject(serverUuid: string, source: ModSource, id: string): Promise<ModProject> {
  if (source === 'curseforge') return curseforgeApi.getProject(serverUuid, id);

  const [project, members] = await Promise.all([getProject(id), getProjectMembers(id).catch(() => [])]);
  const owner = members.find((member) => member.is_owner || member.role === 'Owner') ?? members[0];
  return fromModrinthProject(project, owner?.user.username ?? '');
}

function ModDetailsPage({ source }: { source: ModSource }) {
  const { t: tExt } = useExtTranslations();
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const server = useServerStore((state) => state.server);
  const canInstall = useServerCan('files.create');
  const canSwitch = useServerCan(['files.create', 'files.delete'], false);

  const { installedProject } = useInstalledMods();

  const project = useQuery({
    queryKey: modInstallerQueryKey('project', source, projectId),
    queryFn: () => loadProject(server.uuid, source, projectId!),
    enabled: !!projectId,
  });
  const versions = useProjectVersions(source, project.data?.id);

  const [tab, setTab] = useState<string | null>('description');
  const [installOpen, setInstallOpen] = useState(false);
  const [installVersionId, setInstallVersionId] = useState<string | null>(null);

  const goBack = () => {
    if ((window.history.state?.idx ?? 0) > 0) {
      navigate(-1);
    } else {
      navigate(serverModsPath(server.uuidShort, '/browse'));
    }
  };

  const openInstall = (version: ModVersion | null) => {
    setInstallVersionId(version?.id ?? null);
    setInstallOpen(true);
  };

  const data = project.data;
  const installed = data ? installedProject(source, data.id) : null;

  return (
    <ServerContentContainer title={data?.title ?? tExt('pages.server.mods.title', {})} hideTitleComponent>
      <Button variant='subtle' leftSection={<FontAwesomeIcon icon={faArrowLeft} />} onClick={goBack} mb='sm'>
        {tExt('pages.server.mods.button.back', {})}
      </Button>

      {project.error ? (
        <Alert color='red' title={tExt('pages.server.mods.details.notFound', {})}>
          {httpErrorToHuman(project.error)}
        </Alert>
      ) : !data ? (
        <Spinner.Centered />
      ) : (
        <>
          <InstallModModal
            opened={installOpen}
            onClose={() => setInstallOpen(false)}
            project={{ source, id: data.id, slug: data.slug, title: data.title, iconUrl: data.iconUrl }}
            installed={installed}
            initialVersionId={installVersionId}
          />

          <Paper withBorder p='lg' radius='md' mb='md'>
            <Group justify='space-between' align='flex-start' gap='lg'>
              <Group align='flex-start' wrap='nowrap' gap='lg' style={{ flex: 1, minWidth: 0 }}>
                <Avatar src={data.iconUrl} name={data.title} size={96} radius='md' />
                <Stack gap={6} style={{ minWidth: 0 }}>
                  <Group gap='sm'>
                    <Title order={2}>{data.title}</Title>
                    {installed && (
                      <Badge color='green' variant='light' leftSection={<FontAwesomeIcon icon={faCheck} />}>
                        {installed.enabled
                          ? tExt('pages.server.mods.details.installedVersion', {
                              version: installed.version?.versionNumber ?? installed.fileName,
                            })
                          : tExt('pages.server.mods.details.installedDisabled', {
                              version: installed.version?.versionNumber ?? installed.fileName,
                            })}
                      </Badge>
                    )}
                  </Group>
                  {data.author && (
                    <Text size='sm' c='dimmed'>
                      {tExt('pages.server.mods.browse.by', { author: data.author })}
                    </Text>
                  )}
                  <Text>{data.description}</Text>
                  <Group gap={6}>
                    {[...new Set(data.loaders.filter(isModLoader))].map((loader) => (
                      <LoaderBadge key={loader} loader={loader} />
                    ))}
                    {data.categories
                      .filter((category) => !isModLoader(category))
                      .map((category) => (
                        <Badge key={category} variant='default' tt='capitalize'>
                          {category}
                        </Badge>
                      ))}
                    {data.clientOnly && (
                      <Badge variant='light' color='gray'>
                        {tExt('pages.server.mods.issues.clientOnlyShort', {})}
                      </Badge>
                    )}
                  </Group>
                </Stack>
              </Group>

              <Stack gap='xs' align='stretch'>
                {installed
                  ? canSwitch && (
                      <Button leftSection={<FontAwesomeIcon icon={faRightLeft} />} onClick={() => openInstall(null)}>
                        {tExt('pages.server.mods.button.switchVersion', {})}
                      </Button>
                    )
                  : canInstall && (
                      <Button leftSection={<FontAwesomeIcon icon={faDownload} />} onClick={() => openInstall(null)}>
                        {tExt('pages.server.mods.button.install', {})}
                      </Button>
                    )}
                <Button
                  variant='default'
                  onClick={() => {
                    window.open(data.url, '_blank', 'noopener,noreferrer');
                  }}
                  leftSection={<FontAwesomeIcon icon={faArrowUpRightFromSquare} />}
                >
                  {source === 'curseforge'
                    ? tExt('pages.server.mods.button.openCurseforge', {})
                    : tExt('pages.server.mods.button.openModrinth', {})}
                </Button>
              </Stack>
            </Group>

            <Divider my='md' />

            <Group justify='space-between' gap='lg'>
              <Group gap='xl'>
                <Stat
                  label={tExt('pages.server.mods.details.stats.downloads', {})}
                  value={formatCount(data.downloads)}
                />
                <Stat
                  label={
                    source === 'curseforge'
                      ? tExt('pages.server.mods.details.stats.likes', {})
                      : tExt('pages.server.mods.details.stats.followers', {})
                  }
                  value={formatCount(data.follows)}
                />
                {data.updated && (
                  <Stat
                    label={tExt('pages.server.mods.details.stats.updated', {})}
                    value={<FormattedTimestamp timestamp={data.updated} />}
                  />
                )}
                {data.license && (
                  <Stat label={tExt('pages.server.mods.details.stats.license', {})} value={data.license} />
                )}
              </Group>
              {data.links.length > 0 && (
                <Group gap='md'>
                  {data.links.map((link) => (
                    <Anchor key={link.kind} href={link.url} target='_blank' rel='noopener noreferrer' size='sm'>
                      <FontAwesomeIcon icon={LINK_ICONS[link.kind]} />{' '}
                      {tExt(`pages.server.mods.details.links.${link.kind}`, {})}
                    </Anchor>
                  ))}
                </Group>
              )}
            </Group>
          </Paper>

          <Tabs value={tab} onChange={setTab}>
            <Tabs.List>
              <Tabs.Tab value='description'>{tExt('pages.server.mods.details.tabs.description', {})}</Tabs.Tab>
              <Tabs.Tab value='versions'>
                {tExt('pages.server.mods.details.tabs.versions', {})}
                {versions.data && (
                  <Badge ml='xs' variant='default' size='sm'>
                    {versions.data.length}
                  </Badge>
                )}
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value='description' pt='md'>
              <Paper withBorder p='lg' radius='md'>
                <ModMarkdown content={data.body} format={data.bodyFormat} />
              </Paper>
            </Tabs.Panel>

            <Tabs.Panel value='versions' pt='md'>
              <ModVersionsTab
                versions={versions.data}
                loading={versions.isLoading}
                error={versions.error ? httpErrorToHuman(versions.error) : null}
                installed={installed}
                canInstall={installed ? canSwitch : canInstall}
                onInstall={openInstall}
              />
            </Tabs.Panel>
          </Tabs>
        </>
      )}
    </ServerContentContainer>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack gap={0}>
      <Text size='xs' c='dimmed' tt='uppercase' fw={600}>
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
    </Stack>
  );
}

export const ModrinthDetailsPage = () => <ModDetailsPage source='modrinth' />;
export const CurseforgeDetailsPage = () => <ModDetailsPage source='curseforge' />;
