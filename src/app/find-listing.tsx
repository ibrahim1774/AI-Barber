import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { router } from 'expo-router';
import { DEFAULT_SWATCH } from '@/web/lib/brandSwatches';
import { colors, fonts } from '@/constants/theme';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { Field } from '@/components/Field';
import { ArrowRight } from '@/components/Icons';
import { Em, Text } from '@/components/Text';
import { Card, ErrorNote, StageChips, SwatchRow, WorksWith } from '@/components/Importer';
import { ImportProgress, LISTING_STEPS } from '@/components/ImportProgress';
import { ServiceChecklist } from '@/components/ServiceChecklist';
import { useImportRun } from '@/lib/useImportRun';
import { api, type Candidate, type ListingMatch, type ScrapePayload } from '@/lib/api';
import { fetchListing } from '@/lib/flow';
import { listingMatch, listingSite } from '@/lib/importer';
import { servicesFromPicks, type ServicePicks } from '@/lib/serviceChecklist';

// Shop names for the self-typing placeholder (GbpImportPage TYPE_NAMES).
const TYPE_NAMES = [
  "Jack's Barbershop",
  'Fade Factory',
  'Kings Cut Barbershop',
  'The Sharp Edge',
  'Crown & Blade Barbers',
];

type Suggestion = { placeId: string; main: string; secondary: string };

function toSuggestions(raw: unknown[]): Suggestion[] {
  return raw.filter(
    (s): s is Suggestion =>
      !!s && typeof (s as Suggestion).placeId === 'string' && typeof (s as Suggestion).main === 'string' && !!(s as Suggestion).main,
  );
}

// GbpImportPage.tsx 'name' branch: typeahead (/api/places-autocomplete) →
// "Find my business" candidates (/api/find-business) → /api/import-business.
export default function FindListing() {
  const [bizName, setBizName] = useState('');
  const [brandColor, setBrandColor] = useState(DEFAULT_SWATCH);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [suggestHint, setSuggestHint] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [searchedNear, setSearchedNear] = useState<string | null>(null);
  const [findBusy, setFindBusy] = useState(false);
  const sugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every keystroke, pick and Find: an autocomplete answer for an
  // older query is dropped instead of re-opening the list.
  const reqIdRef = useRef(0);
  const findBusyRef = useRef(false);
  const { busy, progress, slowHint, run, fetchOnly } = useImportRun();
  // The listing found, waiting for "Is this you?"; then (confirmed) the services checklist.
  const [found, setFound] = useState<{ payload: ScrapePayload; match: ListingMatch } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [picks, setPicks] = useState<ServicePicks>({});

  const cancelSuggestions = () => {
    reqIdRef.current += 1;
    if (sugTimer.current) clearTimeout(sugTimer.current);
    sugTimer.current = null;
    setSuggestions(null);
  };

  useEffect(() => () => { reqIdRef.current += 1; if (sugTimer.current) clearTimeout(sugTimer.current); }, []);

  // Suggestions appear as the barber types — debounced 350 ms, min 3 chars.
  const handleNameChange = (v: string) => {
    setBizName(v);
    setCandidates(null);
    reqIdRef.current += 1;
    if (sugTimer.current) clearTimeout(sugTimer.current);
    const q = v.trim();
    if (q.length < 3) { setSuggestions(null); return; }
    const reqId = reqIdRef.current;
    sugTimer.current = setTimeout(async () => {
      try {
        const d = await api.placesAutocomplete(q);
        if (reqId !== reqIdRef.current) return;
        setSuggestHint(typeof d.error === 'string' && d.error ? d.error : null);
        const sugs = toSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []);
        setSuggestions(sugs.length ? sugs : null);
      } catch {
        // Suggestions simply never appear; Find my business still works.
        if (reqId === reqIdRef.current) setSuggestions(null);
      }
    }, 350);
  };

  // Find the listing (progress overlay), then ask "Is this you?" before anything is built.
  const runImport = (pick: { placeId: string } | { query: string }) =>
    void fetchOnly(
      () => fetchListing(pick),
      (payload) => {
        setFound({ payload, match: listingMatch(payload) });
        setConfirmed(false);
        setPicks({});
      },
      (msg) => setError(msg),
    );

  const notMine = () => {
    setFound(null);
    setConfirmed(false);
    setError(null);
  };

  // Build only after "Yes, that's me", with the ticked services.
  const build = () => {
    if (!found || !confirmed) return;
    const payload = found.payload;
    void run(async () => listingSite(payload, servicesFromPicks(picks), brandColor), (msg) => setError(msg));
  };

  // Import by exact NAME + ADDRESS (newer 'Eg…' place ids don't resolve).
  const handleSuggestionPick = (sg: Suggestion) => {
    if (busy) return;
    cancelSuggestions();
    const q = [sg.main, sg.secondary].filter(Boolean).join(', ');
    setBizName(q);
    runImport({ query: q });
  };

  // Search-only pass: list matching businesses so we never import the wrong
  // top match. No device location is sent; the server falls back to IP city.
  const handleFind = async () => {
    const q = bizName.trim();
    if (!q || findBusyRef.current || busy) return;
    findBusyRef.current = true;
    cancelSuggestions();
    setFindBusy(true);
    setError(null);
    setCandidates(null);
    try {
      const d = await api.findBusiness(q);
      if (!d.candidates?.length) {
        setError(
          `No businesses found for "${q}"${d.searchedNear ? ` near ${d.searchedNear}` : ''}. Add your city — e.g. "${q.split(',')[0]}, Houston" — and try again.`,
        );
        return;
      }
      setCandidates(d.candidates);
      setSearchedNear(d.searchedNear || null);
    } catch (e: any) {
      setError(e?.message || 'Search failed — try again.');
    } finally {
      findBusyRef.current = false;
      setFindBusy(false);
    }
  };

  const handlePick = (placeId: string) => {
    if (busy) return;
    setCandidates(null);
    runImport({ placeId });
  };

  return (
    <Screen overlay={busy ? <ImportProgress steps={LISTING_STEPS} progress={progress} slowHint={slowHint} /> : null}>
      <StageChips />
      <Text variant="h1" style={styles.h1}>Type your shop name.</Text>
      <Text variant="h1">
        Get a beautiful <Em>barber</Em> <Em color={colors.silver}>website</Em>.
      </Text>
      <Text variant="body" style={styles.sub}>
        Photos & reviews come from your Google listing. Live in about a minute — edit anything after.
      </Text>

      {found ? (
        <Card>
          <RNText style={styles.pickLabel}>{confirmed ? 'Your services' : 'Is this you?'}</RNText>
          <MatchCard match={found.match} />
          {!confirmed ? (
            <View style={styles.confirm}>
              <Button title="Yes, that's me" arrow onPress={() => setConfirmed(true)} />
              <Button variant="pill" tone="light" title="Not my business" onPress={notMine} />
            </View>
          ) : (
            <View style={styles.confirm}>
              <ServiceChecklist picks={picks} onChange={setPicks} startOpen />
              <View style={styles.actions}>
                <SwatchRow value={brandColor} onChange={setBrandColor} />
                <Button size="sm" title="Build my website" arrow loading={busy} onPress={build} />
              </View>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={notMine}>
                <RNText style={styles.none}>Not my business</RNText>
              </Pressable>
            </View>
          )}
          <ErrorNote message={error} />
        </Card>
      ) : (
      <Card>
        <Field
          label="Type your shop name"
          accessibilityLabel="Your shop name and city"
          value={bizName}
          onChangeText={handleNameChange}
          typeExamples={TYPE_NAMES}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => void handleFind()}
        />

        {suggestHint && !suggestions && !candidates && bizName.trim().length >= 3 && (
          <RNText style={styles.hint}>{suggestHint}</RNText>
        )}

        {suggestions && !candidates && (
          <View style={[styles.list, styles.sugList]}>
            {suggestions.map((sg, i) => (
              <Row
                key={sg.placeId}
                title={sg.main}
                detail={sg.secondary}
                onPress={() => handleSuggestionPick(sg)}
                small
                last={i === suggestions.length - 1}
              />
            ))}
          </View>
        )}

        {!!bizName.trim() && !candidates && (
          <Button
            variant="pill"
            tone="light"
            title={findBusy ? 'Finding businesses near you…' : 'Find my business'}
            arrow
            loading={findBusy}
            onPress={() => void handleFind()}
            style={styles.find}
          />
        )}

        {candidates && (
          <View style={styles.candidates}>
            <RNText style={styles.pickLabel}>
              {searchedNear ? `Found near ${searchedNear} — pick yours` : 'Pick your business'}
            </RNText>
            <View style={styles.list}>
              {candidates.map((c, i) => (
                <Row
                  key={c.placeId}
                  last={i === candidates.length - 1}
                  title={c.title}
                  detail={[c.category, c.address].filter(Boolean).join(' · ')}
                  trailing={c.rating ? `★ ${c.rating}` : ''}
                  onPress={() => handlePick(c.placeId)}
                />
              ))}
            </View>
            <Pressable accessibilityRole="button" hitSlop={8} onPress={() => { setCandidates(null); setError(null); }}>
              <RNText style={styles.none}>None of these? Add your city and search again</RNText>
            </Pressable>
          </View>
        )}

        <View style={styles.actions}>
          <SwatchRow value={brandColor} onChange={setBrandColor} />
          <Button
            size="sm"
            title="Build my website"
            arrow
            loading={busy}
            disabled={findBusy}
            onPress={() => void handleFind()}
          />
        </View>
        <ErrorNote message={error} />
      </Card>
      )}

      <WorksWith names={['Google Business Profile']} />

      <Button
        variant="link"
        title="Can't find your shop? Fill in your details manually →"
        onPress={() => router.push('/manual')}
        style={styles.escape}
      />
      <Button variant="link" title="← Back" onPress={() => router.back()} style={styles.back} />
    </Screen>
  );
}

/** "Is this you?": what the Google import found (photo, name, category, address, rating). */
export function MatchCard({ match }: { match: ListingMatch }) {
  const rating = match.rating != null ? `★ ${match.rating}${match.ratingCount != null ? ` (${match.ratingCount})` : ''}` : null;
  return (
    <View style={styles.match} accessibilityLabel={`${match.name}${match.address ? `, ${match.address}` : ''}`}>
      {match.photoUrl ? <Image source={{ uri: match.photoUrl }} style={styles.matchPhoto} accessibilityIgnoresInvertColors /> : null}
      <View style={styles.rowText}>
        <RNText style={styles.matchName}>{match.name}</RNText>
        {!!match.category && <RNText style={styles.rowDetail}>{match.category}</RNText>}
        {!!match.address && <RNText style={styles.rowDetail}>{match.address}</RNText>}
        {!!rating && <RNText style={[styles.rating, { marginTop: 4 }]}>{rating}</RNText>}
      </View>
    </View>
  );
}

function Row({
  title, detail, trailing, onPress, small, last,
}: { title: string; detail?: string; trailing?: string; onPress(): void; small?: boolean; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, small && styles.rowSmall, last && { borderBottomWidth: 0 }, pressed && { backgroundColor: 'rgba(0,0,0,0.035)' }]}
    >
      <View style={styles.rowText}>
        <RNText numberOfLines={1} style={[styles.rowTitle, small && { fontSize: 13.5 }]}>{title}</RNText>
        {!!detail && (
          <RNText numberOfLines={1} style={[styles.rowDetail, small && { fontSize: 11.5 }]}>{detail}</RNText>
        )}
      </View>
      <View style={styles.rowEnd}>
        {!!trailing && <RNText style={styles.rating}>{trailing}</RNText>}
        <ArrowRight size={13} color={colors.ink} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  h1: { marginTop: 24 },
  sub: { marginTop: 24, maxWidth: 512 },
  hint: { marginTop: 12, fontFamily: fonts.body, fontSize: 12, lineHeight: 19, color: colors.inkMuted },
  list: {
    overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(11,14,20,0.1)', backgroundColor: '#ffffff',
  },
  sugList: {
    marginTop: 12, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 17, shadowOffset: { width: 0, height: 14 },
  },
  find: { marginTop: 20 },
  candidates: { marginTop: 24 },
  pickLabel: {
    marginBottom: 12, fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 2.4, textTransform: 'uppercase',
    color: colors.inkMuted,
  },
  none: {
    marginTop: 12, fontFamily: fonts.bodySemi, fontSize: 10, letterSpacing: 2, textTransform: 'uppercase',
    color: colors.inkMuted,
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.inkRow,
  },
  rowSmall: { paddingVertical: 12 },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.ink },
  rowDetail: { marginTop: 2, fontFamily: fonts.body, fontSize: 12, color: colors.inkMuted },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rating: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.ink },
  actions: { marginTop: 32, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', rowGap: 24, columnGap: 32 },
  escape: { marginTop: 20 },
  confirm: { marginTop: 20, gap: 12 },
  match: {
    flexDirection: 'row', gap: 14, alignItems: 'center', padding: 12, borderRadius: 12, borderWidth: 1,
    borderColor: 'rgba(11,14,20,0.1)', backgroundColor: '#ffffff',
  },
  matchPhoto: { width: 72, height: 72, borderRadius: 10, backgroundColor: 'rgba(11,14,20,0.06)' },
  matchName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  back: { marginTop: 16 },
});
