import { HeaderButton } from '@/components/HeaderButtons';
import { TabHeader } from '@/components/TabHeader';

/** "Store" title, a Share button, and (unless the subscription has lapsed) a labelled Settings button. The shop name is not shown here. */
export function StoreHeader({
  locked, onShare, onSetup,
}: {
  title?: string;
  locked: boolean;
  onShare(): void;
  onSetup(): void;
}) {
  return (
    <TabHeader title="Store">
      <HeaderButton title="Share" icon="share" tone="solid" onPress={onShare} accessibilityLabel="Share shop link" />
      {!locked && <HeaderButton title="Settings" icon="gear" onPress={onSetup} accessibilityLabel="Store setup" />}
    </TabHeader>
  );
}
