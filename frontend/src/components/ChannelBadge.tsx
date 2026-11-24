import Badge from '@/elements/data-display/Badge.tsx';
import type { Channel } from '../lib/catalog.ts';
import { useExtTranslations } from '../translations.ts';

const CHANNEL_COLORS: Record<Channel, string> = {
  release: 'green',
  beta: 'yellow',
  alpha: 'red',
};

export default function ChannelBadge({ channel }: { channel: Channel }) {
  const { t: tExt } = useExtTranslations();

  return (
    <Badge variant='light' color={CHANNEL_COLORS[channel]}>
      {tExt(`pages.server.mods.channel.${channel}`, {})}
    </Badge>
  );
}
