import { useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions } from 'react-native';
import type { Service, Shop } from '@/lib/shop';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { ServicesEditorView } from '@/components/setup/ServicesEditor';
import { serviceAtSitePosition } from '@/lib/setup/servicesMap';
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
  /** Opened from a service card in the preview: that service (its position in the site's list, and its title). */
  focus?: { index: number; title: string } | null;
};

/**
 * The Edit tab's Services sheet once a shop exists. Replaces ServicesSheet,
 * which keeps the Phase 1 behaviour (WebsiteData only) when there is no shop.
 */
export function BookingsServicesSheet({ visible, shop, onServices, onClose, onDismiss, upload, startAdd, focus }: Props) {
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

  const ed = useServicesEditor(shop, onServices, pickPhoto, 'website');
  // Services may have changed in Setup since the last time this was open.
  const { reload } = ed;
  useEffect(() => { if (visible) reload(); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // A closed sheet is back at the list: a form left open (e.g. "+ Add a service" then Done) must not come back.
  const { setView } = ed;
  useEffect(() => { if (!visible) setView({ kind: 'list' }); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const { addOwn } = ed;
  useEffect(() => { if (visible && startAdd) addOwn(); }, [visible, startAdd]); // eslint-disable-line react-hooks/exhaustive-deps

  // A card tapped in the preview opens that service's form. The list loads (and reloads) after the sheet opens, so
  // wait for it; once per open. The site's list is the show-on-site rows, so the position is mapped, not reused.
  const focused = useRef(false);
  useEffect(() => { if (!visible) focused.current = false; }, [visible]);
  const { openForm, loading, services } = ed;
  useEffect(() => {
    if (!visible || !focus || startAdd || focused.current || loading || services.length === 0) return;
    focused.current = true;
    const target = serviceAtSitePosition(services, focus.index, focus.title);
    if (target) openForm(target);
  }, [visible, focus, startAdd, loading, services]); // eslint-disable-line react-hooks/exhaustive-deps

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
        <ServicesEditorView ed={ed} variant="website" />
      </ScrollView>
    </Sheet>
  );
}
