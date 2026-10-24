import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import type { PageKey } from '@/web/lib/render/pages';
import { colors, fonts } from '@/constants/theme';
import { Sheet, SheetAction } from '@/components/EditSheet';
import type { PreviewPage } from '@/lib/editable';
import {
  MULTI_PAGE_NOTE, PLACE_NOTE, addSuggested, changeFromRows, matchesQuery, menuRows, moreStartsAt, moveRow, needsMultiPageConfirm,
  pageRows, placeText, sameChange, serviceGuidesOn, serviceRows, servicesOverCapNote, servicesOverCapOf, setRowOn, showSearch,
  suggestedRows, type PageRow, type PagesChange,
} from '@/lib/sitePages';

export const ROW_H = 64;

/**
 * The Pages sheet, in three groups: Menu pages (every page this site has data for, in menu order, with an on/off
 * switch and a handle to drag it; Home is locked on), Service pages (one per listed service; tap to see it, and
 * the service guides switch) and Suggested pages (guide pages that are off or cannot exist yet, each with an Add
 * button or the reason it is disabled). A search box appears when the lists are long, and a Place name row edits
 * the one place the pages are named after. Nothing is stored until Save; the first Save on a site that has no
 * pages yet is the one-time "becomes a multi-page site" confirm.
 */
export function PagesSheet({
  visible, data, onSave, onEditPlace, onClose, onDismiss,
}: {
  visible: boolean;
  data: WebsiteData;
  /** `show`: a page to open in the preview after saving. */
  onSave(change: PagesChange, show?: PreviewPage): void;
  /** The Place name row: edit the place label (any other change in the sheet is saved first). */
  onEditPlace?(): void;
  onClose(): void;
  onDismiss?(): void;
}) {
  const [rows, setRows] = useState<PageRow[]>(() => pageRows(data));
  const [guides, setGuides] = useState<boolean>(() => serviceGuidesOn(data));
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const confirmFirst = needsMultiPageConfirm(data);

  // Open on the site as it is now; edits wait for Save.
  useEffect(() => {
    if (visible) {
      setRows(pageRows(data));
      setGuides(serviceGuidesOn(data));
      setQuery('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const overCapNote = useMemo(() => servicesOverCapNote(servicesOverCapOf(data)), [data]);
  const services = useMemo(() => serviceRows(data), [data]);
  // Compared with the seed fixed: the real seed is made at Save, so it never decides whether something changed.
  const baseline = useMemo(() => changeFromRows(data, pageRows(data), serviceGuidesOn(data), () => 0), [data]);
  const dirty = useMemo(() => !sameChange(changeFromRows(data, rows, guides, () => 0), baseline), [data, rows, guides, baseline]);

  const save = (show?: PreviewPage) => {
    onSave(changeFromRows(data, rows, guides), show);
    onClose();
  };
  const toggle = (key: PageKey, on: boolean) => setRows((r) => setRowOn(r, key, on));
  const move = (from: number, to: number) => setRows((r) => moveRow(r, from, to));
  const dragOffset = (i: number): number => {
    if (!drag || i === drag.from) return 0;
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -ROW_H;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return ROW_H;
    return 0;
  };

  const menu = menuRows(rows);
  const suggested = suggestedRows(rows);
  const searching = query.trim() !== '';
  const searchable = showSearch(rows.length + services.length);
  const divideAt = moreStartsAt(menu);
  const place = placeText(data);
  const shownServices = services.filter((s) => matchesQuery(s.title, query));
  const shownSuggested = suggested.filter((r) => matchesQuery(r.title, query));

  return (
    <Sheet
      visible={visible}
      title="Pages"
      onClose={onClose}
      onDismiss={onDismiss}
      right={confirmFirst ? undefined : <SheetAction title={dirty ? 'Save' : 'Done'} primary onPress={() => (dirty ? save() : onClose())} />}
    >
      <Text style={styles.lead}>
        Each page is made only from what you have added. Turn a page off to hide it from your menu, and drag the handle to change the order.
      </Text>
      {overCapNote ? <Text style={styles.lead}>{overCapNote}</Text> : null}
      {searchable && (
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search pages"
          placeholderTextColor="rgba(255,255,255,0.3)"
          accessibilityLabel="Search pages"
          selectionColor={colors.accent}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          style={styles.search}
        />
      )}
      <ScrollView style={styles.list} scrollEnabled={!drag} keyboardShouldPersistTaps="handled">
        {!confirmFirst && onEditPlace && !searching && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Place name, ${place || 'not set'}. Change`}
            onPress={() => { if (dirty) onSave(changeFromRows(data, rows, guides)); onEditPlace(); }}
            style={({ pressed }) => [styles.placeRow, pressed && { opacity: 0.6 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Place name</Text>
              <Text style={styles.sub} numberOfLines={1}>{place || 'Not set'}</Text>
            </View>
            <Text style={styles.action}>Change</Text>
          </Pressable>
        )}
        <Text style={styles.group} accessibilityRole="header">Menu pages</Text>
        {menu.map((r, i) => {
          if (searching && !matchesQuery(r.title, query)) return null;
          return (
            <View key={r.key}>
              {!searching && i === divideAt && <Text style={styles.divider}>Below here: under More on the site</Text>}
              <Row
                row={r}
                index={i}
                offset={dragOffset(i)}
                canView={!confirmFirst}
                dragEnabled={!searching}
                onToggle={(on) => toggle(r.key, on)}
                onView={() => save({ key: r.key })}
                onMove={move}
                onDrag={setDrag}
                count={menu.length}
              />
            </View>
          );
        })}
        {!confirmFirst && shownServices.length > 0 && (
          <>
            <Text style={styles.group} accessibilityRole="header">{`Service pages (${services.length})`}</Text>
            <Text style={styles.lead}>Every listed service gets a page (the first 12).</Text>
            {shownServices.map((s) => (
              <Pressable
                key={s.index}
                accessibilityRole="button"
                accessibilityLabel={`Show ${s.title}`}
                onPress={() => save({ key: 'services', index: s.index })}
                style={({ pressed }) => [styles.simple, pressed && { opacity: 0.6 }]}
              >
                <Text style={styles.title} numberOfLines={1}>{s.title}</Text>
              </Pressable>
            ))}
            {!searching && (
              <View style={styles.simple}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>Service guides</Text>
                  <Text style={styles.sub}>Adds About this service text to the page of a service it fits.</Text>
                </View>
                <Switch
                  value={guides}
                  onValueChange={setGuides}
                  accessibilityLabel="Service guides"
                  trackColor={{ false: 'rgba(255,255,255,0.18)', true: colors.accent }}
                />
              </View>
            )}
          </>
        )}
        {!confirmFirst && shownSuggested.length > 0 && (
          <>
            <Text style={styles.group} accessibilityRole="header">Suggested pages</Text>
            {shownSuggested.map((r) => (
              <View key={r.key} style={[styles.simple, !r.eligible && { opacity: 0.6 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>{r.title}</Text>
                  {r.reason ? <Text style={styles.sub}>{r.reason}</Text> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${r.title}`}
                  accessibilityState={{ disabled: !r.eligible }}
                  disabled={!r.eligible}
                  hitSlop={8}
                  onPress={() => setRows((cur) => addSuggested(cur, r.key))}
                  style={({ pressed }) => [styles.add, !r.eligible && styles.addOff, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.addText}>Add</Text>
                </Pressable>
              </View>
            ))}
          </>
        )}
        {!confirmFirst && <Text style={[styles.lead, { marginTop: 12 }]}>{PLACE_NOTE}</Text>}
      </ScrollView>
      {confirmFirst && (
        <View style={styles.note} accessibilityRole="summary">
          <Text style={styles.noteTitle}>{MULTI_PAGE_NOTE}</Text>
          <Text style={styles.noteBody}>
            Your menu will link to the pages you leave on. Your site is not changed online until you publish.
          </Text>
        </View>
      )}
      {confirmFirst && <SheetAction primary title="Make it multi-page" onPress={() => save()} />}
    </Sheet>
  );
}

function Row({
  row, index, count, offset, canView, dragEnabled, onToggle, onView, onMove, onDrag,
}: {
  row: PageRow;
  index: number;
  count: number;
  offset: number;
  canView: boolean;
  dragEnabled: boolean;
  onToggle(on: boolean): void;
  onView(): void;
  onMove(from: number, to: number): void;
  onDrag(d: { from: number; to: number } | null): void;
}) {
  const y = useRef(new Animated.Value(0)).current;
  // The responder lives as long as the row; it reads the latest position through this ref.
  const live = useRef({ index, count, onMove, onDrag });
  live.current = { index, count, onMove, onDrag };
  const target = (dy: number) => Math.max(1, Math.min(live.current.count - 1, live.current.index + Math.round(dy / ROW_H)));
  const canDrag = useRef(!row.locked && dragEnabled);
  canDrag.current = !row.locked && dragEnabled;
  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => canDrag.current,
      onMoveShouldSetPanResponder: () => canDrag.current,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => live.current.onDrag({ from: live.current.index, to: live.current.index }),
      onPanResponderMove: (_e, g) => {
        y.setValue(g.dy);
        live.current.onDrag({ from: live.current.index, to: target(g.dy) });
      },
      onPanResponderRelease: (_e, g) => {
        const to = target(g.dy);
        y.setValue(0);
        live.current.onDrag(null);
        if (to !== live.current.index) live.current.onMove(live.current.index, to);
      },
      onPanResponderTerminate: () => {
        y.setValue(0);
        live.current.onDrag(null);
      },
    }),
  ).current;

  const sub = row.extra ? 'Guide page' : row.children > 0 ? `${row.children} ${row.key === 'services' ? (row.children === 1 ? 'service page' : 'service pages') : row.children === 1 ? 'barber page' : 'barber pages'}` : row.locked ? 'Always on' : undefined;
  return (
    <Animated.View
      style={[styles.row, { transform: [{ translateY: Animated.add(y, offset) }] }, !row.on && styles.rowOff]}
      accessible={false}
    >
      <Thumb kind={row.key} off={!row.on} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${row.title}${row.on ? '' : ', off'}`}
        accessibilityHint={canView ? 'Shows this page in the preview' : undefined}
        onPress={onView}
        disabled={!canView || !row.on}
        style={styles.main}
      >
        <Text style={styles.title} numberOfLines={1}>{row.title}</Text>
        {sub ? <Text style={styles.sub} numberOfLines={1}>{sub}</Text> : null}
      </Pressable>
      <View style={styles.switchBox}>
        <Switch
          value={row.on}
          disabled={row.locked}
          onValueChange={onToggle}
          accessibilityLabel={`${row.title} page`}
          trackColor={{ false: 'rgba(255,255,255,0.18)', true: colors.accent }}
        />
      </View>
      <View
        {...(row.locked || !dragEnabled ? {} : pan.panHandlers)}
        accessible={!row.locked && dragEnabled}
        accessibilityRole="adjustable"
        accessibilityLabel={`Reorder ${row.title}`}
        accessibilityActions={[{ name: 'increment', label: 'Move down' }, { name: 'decrement', label: 'Move up' }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === 'increment') onMove(index, index + 1);
          if (e.nativeEvent.actionName === 'decrement') onMove(index, index - 1);
        }}
        style={[styles.handle, (row.locked || !dragEnabled) && { opacity: 0.2 }]}
        testID={`pages-handle-${row.key}`}
      >
        <View style={styles.bars}><View style={styles.bar} /><View style={styles.bar} /><View style={styles.bar} /></View>
      </View>
    </Animated.View>
  );
}

/** A tiny drawing of what the page holds, so the list reads at a glance. */
function Thumb({ kind, off }: { kind: PageKey; off: boolean }) {
  const c = off ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.7)';
  const a = off ? 'rgba(244,161,0,0.35)' : colors.accent;
  const line = (w: number, k?: string) => <View key={k} style={{ height: 3, width: w, borderRadius: 2, backgroundColor: c, marginTop: 3 }} />;
  let inner: React.ReactNode;
  switch (kind) {
    case 'home':
      inner = (<><View style={{ height: 14, borderRadius: 2, backgroundColor: a }} />{line(22)}{line(14)}</>);
      break;
    case 'gallery':
      inner = (<View style={styles.grid}>{[0, 1, 2, 3].map((n) => <View key={n} style={styles.cell} />)}</View>);
      break;
    case 'team':
      inner = (<View style={styles.people}>{[0, 1].map((n) => <View key={n} style={[styles.dot, { backgroundColor: a }]} />)}</View>);
      break;
    case 'services':
      inner = (<>{[0, 1, 2].map((n) => <View key={n} style={styles.price}><View style={{ height: 3, width: 14, borderRadius: 2, backgroundColor: c }} /><View style={{ height: 3, width: 6, borderRadius: 2, backgroundColor: a }} /></View>)}</>);
      break;
    case 'reviews':
      inner = (<><View style={[styles.stars, { backgroundColor: a }]} />{line(22)}{line(18)}</>);
      break;
    case 'location':
      inner = (<><View style={{ height: 8, width: 8, borderRadius: 4, backgroundColor: a, alignSelf: 'center' }} />{line(22)}{line(14)}</>);
      break;
    case 'book':
    case 'shop':
    case 'contact':
      inner = (<>{line(18)}{line(22)}<View style={{ height: 6, width: 16, borderRadius: 3, backgroundColor: a, marginTop: 5 }} /></>);
      break;
    default:
      inner = (<>{line(24)}{line(20)}{line(22)}{line(12)}</>);
  }
  return <View style={[styles.thumb, off && { opacity: 0.6 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{inner}</View>;
}

const styles = StyleSheet.create({
  lead: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: 'rgba(255,255,255,0.6)', marginBottom: 10 },
  list: { maxHeight: 520 },
  search: {
    fontFamily: fonts.body, fontSize: 15, color: '#fff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10,
  },
  group: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)',
    marginTop: 10, marginBottom: 8,
  },
  divider: { fontFamily: fonts.body, fontSize: 12, color: colors.accent, marginBottom: 8, marginTop: 2 },
  placeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8, borderRadius: 10,
    backgroundColor: '#1d1d1d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  action: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent },
  simple: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8, borderRadius: 10,
    backgroundColor: '#1d1d1d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', minHeight: 48,
  },
  add: { paddingHorizontal: 16, height: 36, justifyContent: 'center', borderRadius: 18, backgroundColor: colors.accent },
  addOff: { backgroundColor: 'rgba(255,255,255,0.18)' },
  addText: { fontFamily: fonts.headingBlack, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.buttonInk },
  row: {
    height: ROW_H - 8, marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingLeft: 10, paddingRight: 4, borderRadius: 10,
    backgroundColor: '#1d1d1d', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  rowOff: { backgroundColor: '#171717' },
  main: { flex: 1, justifyContent: 'center', height: '100%' },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
  sub: { fontFamily: fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 },
  switchBox: { width: 54, height: ROW_H - 10, alignItems: 'center', justifyContent: 'center' },
  handle: { width: 44, height: '100%', alignItems: 'center', justifyContent: 'center' },
  bars: { gap: 3 },
  bar: { width: 16, height: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.55)' },
  thumb: {
    width: 34, height: 40, borderRadius: 5, padding: 5, overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 2 },
  cell: { width: 11, height: 12, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.45)' },
  people: { flexDirection: 'row', gap: 3, marginTop: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  price: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  stars: { height: 4, width: 18, borderRadius: 2, marginBottom: 2 },
  note: {
    marginTop: 4, marginBottom: 8, padding: 12, borderRadius: 10,
    backgroundColor: 'rgba(244,161,0,0.10)', borderWidth: 1, borderColor: 'rgba(244,161,0,0.4)',
  },
  noteTitle: { fontFamily: fonts.bodyBold, fontSize: 14, color: '#fff' },
  noteBody: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 17, color: 'rgba(255,255,255,0.7)', marginTop: 4 },
});
