import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { copyLabel } from '@/lib/editor';
import { copyPath } from '@/lib/editable';
import type { PageRef } from '@/lib/pageFile';
import { copyKeysOfPage, moveRowBy, neighbour, pageGoneReason, sectionPageFor, sectionRows, setSectionHidden, type SectionRow } from '@/lib/pageSections';
import { isCopyEdited } from '@/lib/copyEdit';
import { heroOfPage } from '@/lib/pageFile';
import { SAMPLE_HERO_NOTE } from '@/lib/pageHero';
import type { SectionKey } from '@/lib/sections/list';

const SOURCE_TITLE: Record<SectionKey, string> = {
  services: 'Services', team: 'Team', hours: 'Hours', gallery: 'Gallery', about: 'About', contact: 'Contact', reviews: 'Reviews',
};

/**
 * "Edit this page": the sections of the page on screen. Each can be hidden and moved up or down (the layout is
 * shared by every page of the same type, for example all service pages). Text sections open the text editor,
 * the photo opens Change image, and a section made from the shop's facts opens the editor where they live. The
 * page heading is fixed.
 */
export function PageSectionsSheet({
  visible, data, page, title, onChange, onEditText, onChangeImage, onOpenSource, onClose, onDismiss,
}: {
  visible: boolean;
  data: WebsiteData;
  page: PageRef;
  /** The page's name (a service's own name on its page). */
  title: string;
  onChange(change: (d: WebsiteData) => WebsiteData): void;
  onEditText(path: string): void;
  onChangeImage(path: string): void;
  onOpenSource(key: SectionKey): void;
  onClose(): void;
  onDismiss?(): void;
}) {
  const sectionPage = sectionPageFor(page);
  const rows = sectionPage ? sectionRows(data, page) : [];
  const gone = pageGoneReason(data, page);
  const hero = heroOfPage(data, page);
  const guideKeys = page.key === 'services' ? copyKeysOfPage(data, page) : [];

  return (
    <Sheet visible={visible} title={title} onClose={onClose} onDismiss={onDismiss} right={<SheetAction title="Done" primary onPress={onClose} />}>
      <Text style={styles.lead}>Hide a section or move it up or down. The heading stays. Hiding a section keeps what you wrote.</Text>
      {gone ? <Text style={styles.warn} accessibilityRole="alert">{gone}</Text> : null}
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
        <View style={styles.row}>
          <Text style={[styles.name, { flex: 1 }]}>Heading</Text>
          <Text style={styles.sub}>Always shown</Text>
        </View>
        {rows.map((r) => (
          <View key={r.id}>
            <SectionLine
              row={r}
              canUp={neighbour(rows, r.id, -1) !== null}
              canDown={neighbour(rows, r.id, 1) !== null}
              sample={r.kind === 'photo' && !!hero?.sample}
              onHidden={(hidden) => sectionPage && onChange((d) => setSectionHidden(d, sectionPage, r.id, hidden))}
              onMove={(delta) => onChange((d) => moveRowBy(d, page, r.id, delta))}
              onAction={() => {
                if (r.kind === 'photo' && hero) onChangeImage(hero.path);
                else if (r.kind === 'text' && r.copyKey) onEditText(copyPath(r.copyKey));
                else if (r.kind === 'data' && r.source) onOpenSource(r.source);
              }}
            />
            {r.kind === 'guide' &&
              guideKeys.map((k) => (
                <Pressable
                  key={k}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit text: ${copyLabel(k)}`}
                  onPress={() => onEditText(copyPath(k))}
                  style={({ pressed }) => [styles.child, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.childName} numberOfLines={1}>{copyLabel(k)}</Text>
                  <Text style={styles.action}>{isCopyEdited(data, k) ? 'Edited' : 'Edit'}</Text>
                </Pressable>
              ))}
          </View>
        ))}
        {rows.length === 0 && <Text style={styles.lead}>This page has no sections to change.</Text>}
      </ScrollView>
    </Sheet>
  );
}

function SectionLine({
  row, canUp, canDown, sample, onHidden, onMove, onAction,
}: {
  row: SectionRow;
  canUp: boolean;
  canDown: boolean;
  sample: boolean;
  onHidden(hidden: boolean): void;
  onMove(delta: -1 | 1): void;
  onAction(): void;
}) {
  const actionTitle =
    row.kind === 'photo' ? 'Change image'
    : row.kind === 'text' ? 'Edit text'
    : row.kind === 'data' && row.source ? `Edit in ${SOURCE_TITLE[row.source]}`
    : null;
  return (
    <View style={[styles.row, row.hidden && { opacity: 0.6 }]}>
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={2}>{row.label}</Text>
        {sample ? <Text style={styles.sub}>{SAMPLE_HERO_NOTE}</Text> : null}
        {actionTitle ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`${actionTitle}: ${row.label}`} hitSlop={8} onPress={onAction}>
            <Text style={styles.action}>{actionTitle}</Text>
          </Pressable>
        ) : null}
      </View>
      <Arrow label={`Move ${row.label} up`} glyph={'↑'} disabled={!canUp} onPress={() => onMove(-1)} />
      <Arrow label={`Move ${row.label} down`} glyph={'↓'} disabled={!canDown} onPress={() => onMove(1)} />
      <Switch
        value={!row.hidden}
        onValueChange={(on) => onHidden(!on)}
        accessibilityLabel={`Show ${row.label}`}
        trackColor={{ false: 'rgba(255,255,255,0.18)', true: colors.accent }}
      />
    </View>
  );
}

function Arrow({ label, glyph, disabled, onPress }: { label: string; glyph: string; disabled: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.arrow, (disabled || pressed) && { opacity: disabled ? 0.25 : 0.6 }]}
    >
      <Text style={styles.arrowText}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  lead: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.6)', marginBottom: 10 },
  warn: {
    fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 18, color: '#fff', marginBottom: 10, padding: 10, borderRadius: 8,
    backgroundColor: 'rgba(244,161,0,0.12)', borderWidth: 1, borderColor: 'rgba(244,161,0,0.4)',
  },
  list: { maxHeight: 460 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 12, paddingRight: 6, paddingVertical: 8, marginBottom: 8, borderRadius: 10,
    backgroundColor: '#1d1d1d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', minHeight: 52,
  },
  name: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
  sub: { fontFamily: fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  action: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent, marginTop: 4 },
  child: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginLeft: 16, marginBottom: 6,
    paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.05)',
  },
  childName: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: '#fff' },
  arrow: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontFamily: fonts.bodyBold, fontSize: 18, color: '#fff' },
});
