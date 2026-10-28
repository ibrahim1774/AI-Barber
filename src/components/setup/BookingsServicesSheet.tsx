import { useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';
import type { Service, Shop } from '@/lib/shop';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { router } from 'expo-router';
import { ServicesEditorView } from '@/components/setup/ServicesEditor';
import { useServicesEditor } from '@/components/setup/useServicesEditor';

type Props = {
  visible: boolean;
  shop: Shop;
  /** Called with the fresh ab_services list after every write; the Edit tab mirrors it into WebsiteData.services. */
  onServices(services: Service[]): void;
  onClose(): void;
  onDismiss?(): void;
  /** Picks and uploads one photo through the editor's upload guard; null if cancelled. */
  upload(onPicked?: () => void): Promise<string | null>;
  /** Opened from the preview's "+ Add a service": start at the new-service form. */
  startAdd?: boolean;
};

/**
 * The Edit tab's Services sheet once a shop exists. Replaces ServicesSheet,
 * which keeps the Phase 1 behaviour (WebsiteData only) when there is no shop.
 */
export function BookingsServicesSheet({ visible, shop, onServices, onClose, onDismiss, upload, startAdd }: Props) {
  const { height } = useWindowDimensions();
  const [picking, setPicking] = useState(false);
  const afterDismiss = useRef<(() => void) | null>(null);

  // iOS can't show the photo picker over a sheet: hide it, pick from onDismiss, bring it back.
  const pickPhoto = () =>
    new Promise<string | null>((resolve, reject) => {
      afterDismiss.current = () => {
        upload().then(resolve, reject).finally(() => setPicking(false));
      };
      setPicking(true);
    });

  const ed = useServicesEditor(shop, onServices, pickPhoto);
  // Services may have changed in Setup since the last time this was open.
  const { reload } = ed;
  useEffect(() => { if (visible) reload(); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // A closed sheet is back at the list: a form left open (e.g. "+ Add a service" then Done) must not come back.
  const { setView } = ed;
  useEffect(() => { if (!visible) setView({ kind: 'list' }); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const { addOwn } = ed;
  useEffect(() => { if (visible && startAdd) addOwn(); }, [visible, startAdd]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDismiss = () => {
    const next = afterDismiss.current;
    afterDismiss.current = null;
    if (next) next();
    else onDismiss?.();
  };
  const title = ed.view.kind === 'add' ? 'Add a service' : ed.view.kind === 'form' ? (ed.view.id ? 'Edit service' : 'New service') : 'Services';

  return (
    <Sheet
      visible={visible && !picking}
      title={title}
      onClose={onClose}
      onDismiss={handleDismiss}
      right={<SheetAction title="Done" primary onPress={onClose} />}
    >
      <ScrollView style={{ maxHeight: Math.max(240, height * 0.85 - 150) }} keyboardShouldPersistTaps="handled">
        <ServicesEditorView ed={ed} onGetPaid={() => { onClose(); router.push('/get-paid'); }} />
      </ScrollView>
    </Sheet>
  );
}
