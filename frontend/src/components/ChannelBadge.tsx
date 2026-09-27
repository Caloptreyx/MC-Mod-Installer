import Badge from '@/elements/data-display/Badge.tsx';
import type { ModrinthVersionType } from '../api/modrinth.ts';
import { useExtTranslations } from '../translations.ts';

const CHANNEL_COLORS: Record<ModrinthVersionType, string> = {
  release: 'green',
  beta: 'yellow',
  alpha: 'red',
};

export default function ChannelBadge({ channel }: { channel: ModrinthVersionType }) {
  const { t: tExt } = useExtTranslations();

  return (
    <Badge variant='light' color={CHANNEL_COLORS[channel]}>
      {tExt(`pages.server.mods.channel.${channel}`, {})}
    </Badge>
  );
}
