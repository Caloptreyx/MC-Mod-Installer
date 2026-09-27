import Badge from '@/elements/data-display/Badge.tsx';
import { loaderColor, loaderLabel } from '../lib/constants.ts';

export default function LoaderBadge({ loader }: { loader: string }) {
  return (
    <Badge variant='light' color={loaderColor(loader)}>
      {loaderLabel(loader)}
    </Badge>
  );
}
