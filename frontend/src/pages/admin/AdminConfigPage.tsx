import { faCheck, faFloppyDisk, faTrash } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { Center } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { httpErrorToHuman } from '@/api/axios.ts';
import Button from '@/elements/buttons/Button.tsx';
import Badge from '@/elements/data-display/Badge.tsx';
import TitleCard from '@/elements/data-display/TitleCard.tsx';
import Alert from '@/elements/feedback/Alert.tsx';
import Spinner from '@/elements/feedback/Spinner.tsx';
import PasswordInput from '@/elements/input/PasswordInput.tsx';
import Group from '@/elements/layout/Group.tsx';
import Stack from '@/elements/layout/Stack.tsx';
import Anchor from '@/elements/typography/Anchor.tsx';
import Text from '@/elements/typography/Text.tsx';
import { useAdminCan } from '@/plugins/usePermissions.ts';
import { useToast } from '@/providers/ToastProvider.tsx';
import { getAdminSettings, saveCurseforgeKey, verifyCurseforgeKey } from '../../api/admin.ts';
import { modInstallerQueryKey } from '../../lib/constants.ts';
import { useExtTranslations } from '../../translations.ts';

const SETTINGS_KEY = modInstallerQueryKey('admin', 'settings');

/** Extension configuration page: the CurseForge API key that enables CurseForge as a mod source. */
export default function AdminConfigPage() {
  const { t: tExt } = useExtTranslations();
  const { addToast } = useToast();
  const queryClient = useQueryClient();
  const canManage = useAdminCan('modinstaller.manage');
  const settings = useQuery({ queryKey: SETTINGS_KEY, queryFn: getAdminSettings });

  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState<'save' | 'remove' | 'verify' | null>(null);

  if (settings.isPending) {
    return (
      <Center py='lg'>
        <Spinner />
      </Center>
    );
  }
  if (settings.isError) {
    return <Alert color='red'>{httpErrorToHuman(settings.error)}</Alert>;
  }

  const run = async (action: 'save' | 'remove' | 'verify') => {
    setBusy(action);
    try {
      if (action === 'verify') {
        await verifyCurseforgeKey(apiKey.trim() || undefined);
        addToast(tExt('pages.admin.modinstaller.toast.verified', {}), 'success');
      } else {
        const saved = await saveCurseforgeKey(action === 'save' ? apiKey.trim() : '');
        queryClient.setQueryData(SETTINGS_KEY, saved);
        setApiKey('');
        addToast(
          action === 'save'
            ? tExt('pages.admin.modinstaller.toast.saved', {})
            : tExt('pages.admin.modinstaller.toast.removed', {}),
          'success',
        );
      }
    } catch (error) {
      addToast(httpErrorToHuman(error), 'error');
    } finally {
      setBusy(null);
    }
  };

  const configured = settings.data.curseforgeConfigured;

  return (
    <TitleCard
      title='CurseForge'
      icon={<FontAwesomeIcon icon={faCheck} />}
      rightSection={
        <Badge variant='light' color={configured ? 'green' : 'gray'}>
          {configured
            ? tExt('pages.admin.modinstaller.enabled', {})
            : tExt('pages.admin.modinstaller.notConfigured', {})}
        </Badge>
      }
    >
      <Stack gap='md'>
        <Text size='sm'>
          {tExt('pages.admin.modinstaller.description', {})}{' '}
          <Anchor href='https://console.curseforge.com/' target='_blank' rel='noopener noreferrer'>
            {tExt('pages.admin.modinstaller.console', {})}
          </Anchor>
        </Text>

        <PasswordInput
          label={
            configured ? tExt('pages.admin.modinstaller.replaceKey', {}) : tExt('pages.admin.modinstaller.apiKey', {})
          }
          placeholder={
            configured
              ? tExt('pages.admin.modinstaller.keepPlaceholder', {})
              : tExt('pages.admin.modinstaller.pastePlaceholder', {})
          }
          value={apiKey}
          onChange={(event) => setApiKey(event.currentTarget.value)}
          disabled={!canManage}
        />

        <Group>
          <Button
            leftSection={<FontAwesomeIcon icon={faFloppyDisk} />}
            loading={busy === 'save'}
            disabled={!canManage || !apiKey.trim() || busy !== null}
            onClick={() => run('save')}
          >
            {tExt('pages.admin.modinstaller.save', {})}
          </Button>
          <Button
            variant='default'
            leftSection={<FontAwesomeIcon icon={faCheck} />}
            loading={busy === 'verify'}
            disabled={!canManage || (!apiKey.trim() && !configured) || busy !== null}
            onClick={() => run('verify')}
          >
            {apiKey.trim()
              ? tExt('pages.admin.modinstaller.testKey', {})
              : tExt('pages.admin.modinstaller.testStoredKey', {})}
          </Button>
          {configured && (
            <Button
              variant='default'
              color='red'
              leftSection={<FontAwesomeIcon icon={faTrash} />}
              loading={busy === 'remove'}
              disabled={!canManage || busy !== null}
              onClick={() => run('remove')}
            >
              {tExt('pages.admin.modinstaller.remove', {})}
            </Button>
          )}
        </Group>
      </Stack>
    </TitleCard>
  );
}
