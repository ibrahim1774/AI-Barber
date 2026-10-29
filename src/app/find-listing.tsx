import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { router } from 'expo-router';
import { DEFAULT_SWATCH } from '@/web/lib/brandSwatches';
import { colors, fonts } from '@/constants/theme';
import { Screen } from '@/components/Screen';
import { Button } from '@/components/Button';
import { ArrowRight } from '@/components/Icons';
import { FlowError, FlowHelper, FlowInput, FlowTitle, PillButton } from '@/components/FlowParts';
import { ImportProgress, LISTING_STEPS } from '@/components/ImportProgress';
import { ServiceChecklist } from '@/components/ServiceChecklist';
import { useImportRun } from '@/lib/useImportRun';
import { useRevealAboveKeyboard } from '@/lib/keyboard';
import { api, type Candidate, type ListingMatch, type ScrapePayload } from '@/lib/api';
import { fetchListing } from '@/lib/flow';
import { backToStart, confirmCancel } from '@/lib/nav';
import { listingMatch, listingSite } from '@/lib/importer';
import { servicesFromPicks, type ServicePicks } from '@/lib/serviceChecklist';

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
  const { busy, progress, slowHint, run, fetchOnly, cancel } = useImportRun();
  // The listing found, waiting for "Is this you?"; then (confirmed) the services checklist.
  const [found, setFound] = useState<{ payload: ScrapePayload; match: ListingMatch } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [picks, setPicks] = useState<ServicePicks>({});

  const reveal = useRevealAboveKeyboard([suggestions, candidates, bizName.trim().length > 0, error]);

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
        setCandidates(null);
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

  // Prices that could not be pulled stay blank (no sample prices on the Google start).
  // Build only after "Yes, that's me", with the ticked services.
  const build = () => {
    if (!found || !confirmed) return;
    const payload = found.payload;
    void run(async () => listingSite(payload, servicesFromPicks(picks), DEFAULT_SWATCH), (msg) => setError(msg), '/import-review');
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
    // The list stays up while importing; it is cleared only on success (see runImport), so a failed
    // import leaves it there for a retry or another pick.
    runImport({ placeId });
  };

  // Back steps through the stages: services → "Is this you?" → search → the previous screen.
  // While the listing is being fetched or built: confirm, then drop the pending result and leave for Start.
  const back = () => {
    if (busy) { confirmCancel(() => { cancel(); backToStart(); }); return; }
    if (found && confirmed) { setConfirmed(false); return; }
    if (found) { notMine(); return; }
    backToStart();
  };

  // "Search again": a fresh search, the typed name cleared.
  const searchAgain = () => {
    notMine();
    setBizName('');
    setCandidates(null);
    setSuggestions(null);
  };

  return (
    <Screen
      onBack={back}
      scrollRef={reveal.scrollRef}
      onScroll={reveal.onScroll}
      overlay={busy ? <ImportProgress steps={LISTING_STEPS} progress={progress} slowHint={slowHint} /> : null}
    >
      {found ? (
        <>
          <FlowTitle inline first={confirmed ? 'Your' : 'Is this'} second={confirmed ? 'services' : 'you?'} />
          <View style={styles.stage}>
            <MatchCard match={found.match} />
            {!confirmed ? (
              <>
                <FlowHelper>Photos, hours and phone come along.</FlowHelper>
                <View style={styles.yesNo}>
                  <PillButton primary title="Yes, that's me" onPress={() => setConfirmed(true)} style={styles.half} />
                  <PillButton title="Not mine" onPress={notMine} style={styles.half} />
                </View>
                <Button variant="link" title="Search again" onPress={searchAgain} style={styles.escape} />
              </>
            ) : (
              <>
                <View style={styles.checklist}>
                  <ServiceChecklist tone="dark" picks={picks} onChange={setPicks} startOpen />
                </View>
                <PillButton primary arrow title="Build my website" loading={busy} onPress={build} style={styles.cta} />
                <Button variant="link" title="Not my business" onPress={notMine} style={styles.escape} />
              </>
            )}
            <FlowError message={error} />
          </View>
        </>
      ) : (
        <>
          <FlowTitle first="Find your" second="shop" />
          <View ref={reveal.cardRef} collapsable={false} style={styles.stage}>
            <FlowInput
              label="Shop name"
              accessibilityLabel="Your shop name and city"
              value={bizName}
              onChangeText={handleNameChange}
              placeholder="Jack's Barbershop, Austin"
              autoCorrect={false}
              returnKeyType="search"
              onSubmitEditing={() => void handleFind()}
            />
            {!suggestions && !candidates && !(suggestHint && bizName.trim().length >= 3) && (
              <FlowHelper>Photos, hours and reviews come from your Google listing.</FlowHelper>
            )}

            {suggestHint && !suggestions && !candidates && bizName.trim().length >= 3 && (
              <FlowHelper>{suggestHint}</FlowHelper>
            )}

            {suggestions && !candidates && (
              <View style={styles.list}>
                {suggestions.map((sg, i) => (
                  <Row
                    key={sg.placeId}
                    title={sg.main}
                    detail={sg.secondary}
                    onPress={() => handleSuggestionPick(sg)}
                    last={i === suggestions.length - 1}
                  />
                ))}
              </View>
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

            {!!bizName.trim() && !candidates && (
              <PillButton
                primary
                arrow
                title={findBusy ? 'Finding businesses near you…' : 'Find my business'}
                loading={findBusy}
                disabled={busy}
                onPress={() => void handleFind()}
                style={styles.cta}
              />
            )}
            <FlowError message={error} />
          </View>
          <Button
            variant="link"
            title="Can't find your shop? Fill in your details manually →"
            onPress={() => router.push('/manual')}
            style={styles.escape}
          />
        </>
      )}
    </Screen>
  );
}

/** "Is this you?": what the Google import found (photo, name, category, address, rating). */
export function MatchCard({ match }: { match: ListingMatch }) {
  const reviews = match.rating != null && match.ratingCount != null ? `${match.ratingCount} reviews` : null;
  return (
    <View style={styles.match} accessibilityLabel={`${match.name}${match.address ? `, ${match.address}` : ''}`}>
      {match.photoUrl ? (
        <Image source={{ uri: match.photoUrl }} style={styles.matchPhoto} accessibilityIgnoresInvertColors />
      ) : (
        <View style={styles.matchPhoto} />
      )}
      <View style={styles.rowText}>
        <RNText style={styles.matchName}>{match.name}</RNText>
        {!!match.category && <RNText style={styles.rowDetail}>{match.category}</RNText>}
        {!!match.address && <RNText style={styles.rowDetail}>{match.address}</RNText>}
        {match.rating != null && (
          <RNText style={styles.ratingLine}>
            <RNText style={styles.ratingGold}>{`★ ${match.rating}`}</RNText>
            {reviews ? ` · ${reviews}` : ''}
          </RNText>
        )}
      </View>
    </View>
  );
}

function Row({
  title, detail, trailing, onPress, last,
}: { title: string; detail?: string; trailing?: string; onPress(): void; last?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, last && { borderBottomWidth: 0 }, pressed && { backgroundColor: 'rgba(237,239,244,0.06)' }]}
    >
      <View style={styles.rowText}>
        <RNText numberOfLines={1} style={styles.rowTitle}>{title}</RNText>
        {!!detail && <RNText numberOfLines={1} style={styles.rowDetail}>{detail}</RNText>}
      </View>
      <View style={styles.rowEnd}>
        {!!trailing && <RNText style={styles.ratingGold}>{trailing}</RNText>}
        <ArrowRight size={13} color={colors.muted} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stage: { alignSelf: 'stretch', marginTop: 28 },
  list: {
    marginTop: 14, overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: colors.ghostBorder, backgroundColor: colors.ghostBg,
  },
  candidates: { marginTop: 8 },
  pickLabel: {
    marginTop: 18, fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 2.4, textTransform: 'uppercase', color: colors.muted,
  },
  none: {
    marginTop: 14, fontFamily: fonts.bodySemi, fontSize: 10.5, letterSpacing: 2, textTransform: 'uppercase', color: colors.faint, textAlign: 'center',
  },
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16,
    paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.hair,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontFamily: fonts.bodySemi, fontSize: 14.5, color: colors.text },
  rowDetail: { marginTop: 2, fontFamily: fonts.body, fontSize: 12.5, color: colors.muted },
  rowEnd: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  ratingGold: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.accent },
  ratingLine: { marginTop: 4, fontFamily: fonts.body, fontSize: 12.5, color: colors.muted },
  cta: { marginTop: 24 },
  escape: { marginTop: 22 },
  yesNo: { marginTop: 22, flexDirection: 'row', gap: 12 },
  half: { flex: 1, paddingHorizontal: 12 },
  checklist: { marginTop: 18 },
  match: {
    flexDirection: 'row', gap: 14, alignItems: 'center', padding: 14, borderRadius: 22, borderWidth: 1,
    borderColor: colors.ghostBorder, backgroundColor: colors.ghostBg,
  },
  matchPhoto: { width: 64, height: 64, borderRadius: 16, backgroundColor: 'rgba(237,239,244,0.1)' },
  matchName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text },
});
