import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { goBackOrHome } from '@/lib/nav';
import { searchDomains } from '@/lib/domains/api';
import {
  DOMAIN_DISCLOSURE, DOMAIN_PRICE_LINE, DOMAIN_SUPPORT_LINE, buyable, retryLaterMessage, statusView, type SearchResult,
} from '@/lib/domains/model';
import { useDomainFlow, type BuyResult } from '@/lib/domains/useDomainFlow';
import { loadSite } from '@/lib/siteStore';

export const POLL_MS = 5000;
/** While the secure connection is still being set up (live, SSL pending): slower, and not for ever. */
export const SLOW_POLL_MS = 30_000;
export const SLOW_POLL_LIMIT_MS = 15 * 60_000;
export const CHECK_BACK_NOTE = 'Your domain is set up. The secure connection can take a little longer — check back soon.';

const MESSAGES: Partial<Record<BuyResult['kind'], string>> = {
  taken: 'That name was just taken. Pick another.',
  'not-eligible': "That name isn't available at the standard price. Pick another.",
  inactive: "Your domain subscription isn't active. Restore purchases, or buy again.",
  unconfirmed: "We couldn't confirm the purchase yet. If you were charged, try again in a minute — you won't pay twice.",
  'no-site': 'Publish your website first, then add a domain.',
};

/**
 * Settings → Custom domain. Search a .com (suggestions from the shop name), buy it (the `custom_domain`
 * paywall, or straight to the claim with an unused paid slot), then follow it: Registering → Linking →
 * "Live in a few minutes" → Live.
 */
export default function Domain() {
  const flow = useDomainFlow();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [support, setSupport] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const searchSeq = useRef(0);

  const view = statusView(flow.status);
  const showStatus = flow.loaded && !searchMode && !!flow.status?.domain && view.phase !== 'none';

  const search = useCallback(async (text: string) => {
    const query = text.trim();
    if (!query) return;
    const mine = ++searchSeq.current;
    setSearching(true);
    setMessage(null);
    try {
      const r = await searchDomains(query, flow.domainTx);
      if (mine === searchSeq.current) setResults(r);
    } catch (e: any) {
      if (mine === searchSeq.current) setMessage(e?.message || "Couldn't search right now. Try again.");
    } finally {
      if (mine === searchSeq.current) setSearching(false);
    }
  }, [flow.domainTx]);

  // Suggestions from the shop name, once.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || showStatus || !flow.loaded) return;
    seeded.current = true;
    void loadSite().then((s) => {
      const name = (s?.data.shopName || s?.inputs.shopName || '').trim();
      if (!name) return;
      setQ(name);
      void search(name);
    });
  }, [flow.loaded, showStatus, search]);

  // Follow the claim while the server is still working on it: one read at a time; every 5 s, or every 30 s
  // while only the secure connection is pending, which stops after 15 min with a note.
  const poll = flow.poll;
  const slowSince = useRef<number | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  useEffect(() => {
    if (!view.slowPoll) {
      slowSince.current = null;
      setGaveUp(false);
    } else if (slowSince.current == null) slowSince.current = Date.now();
  }, [view.slowPoll]);
  useEffect(() => {
    if (!showStatus || !view.polling || gaveUp) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const next = () => {
      timer = setTimeout(async () => {
        if (view.slowPoll && slowSince.current != null && Date.now() - slowSince.current >= SLOW_POLL_LIMIT_MS) {
          if (alive) setGaveUp(true);
          return;
        }
        await poll();
        if (alive) next();
      }, view.slowPoll ? SLOW_POLL_MS : POLL_MS);
    };
    next();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [showStatus, view.polling, view.slowPoll, gaveUp, poll]);

  const after = (r: BuyResult) => {
    setSupport(r.kind === 'support');
    if (r.kind === 'live' || r.kind === 'progress' || r.kind === 'failed' || r.kind === 'slot-in-use') {
      setSearchMode(false);
      setMessage(null);
      return;
    }
    setMessage(r.kind === 'support' ? null : r.kind === 'retry-later' ? retryLaterMessage(r.code) : MESSAGES[r.kind] ?? null);
    if (r.kind === 'taken' || r.kind === 'not-eligible') void search(q);
  };

  const buy = async (domain: string) => {
    if (flow.busy) return;
    after(await flow.buy(domain));
  };

  const retry = async () => after(await flow.retry());
  const renew = async () => after(await flow.renew());

  if (!flow.loaded) {
    return (
      <Page title="Custom domain" onBack={goBackOrHome}>
        <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />
      </Page>
    );
  }

  if (showStatus) {
    return (
      <Page title="Custom domain" onBack={goBackOrHome}>
        <View style={st.card}>
          <Text style={st.domain} selectable>{flow.status!.domain}</Text>
          <Text style={[st.state, view.phase === 'live' && { color: '#22c55e' }]}>{view.title}</Text>
          {!!view.detail && <Text style={st.p}>{view.detail}</Text>}
          {view.polling && !gaveUp && <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} />}
          {gaveUp && <Text style={st.p}>{CHECK_BACK_NOTE}</Text>}
          {view.renew && <Button title="Renew" loading={flow.busy} onPress={() => void renew()} style={st.gap} />}
          {flow.status?.sandbox && <Text style={st.small}>Test purchase: nothing was registered.</Text>}
          {view.retrySame && <Button title="Try again" loading={flow.busy} onPress={() => void retry()} style={st.gap} />}
          {view.pickAnother && (
            <Button
              variant={view.retrySame ? 'ghost' : 'primary'}
              title="Pick another name"
              onPress={() => { setSearchMode(true); setResults(null); seeded.current = false; }}
              style={st.gap}
            />
          )}
          {(view.needsSupport || support) && <Text style={[st.p, st.gap]}>{DOMAIN_SUPPORT_LINE}</Text>}
          {!!message && <Text style={[st.error, st.gap]}>{message}</Text>}
        </View>
        <Text style={st.disclosure}>{DOMAIN_DISCLOSURE}</Text>
      </Page>
    );
  }

  return (
    <Page title="Custom domain" onBack={goBackOrHome}>
      <Text style={st.h}>{DOMAIN_PRICE_LINE}</Text>
      <Text style={st.p}>Your website at your own address, like freshcuts.com. Linked for you.</Text>
      <View style={st.searchRow}>
        <TextInput
          accessibilityLabel="Search for a name"
          placeholder="Your shop name"
          placeholderTextColor={colors.faint}
          value={q}
          onChangeText={setQ}
          onSubmitEditing={() => void search(q)}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          style={st.input}
        />
        <Button size="sm" title="Search" loading={searching} onPress={() => void search(q)} />
      </View>
      {results && (
        <View style={st.list}>
          {results.length === 0 && <Text style={st.p}>No .com names found for that. Try another.</Text>}
          {results.map((r) => {
            const ok = buyable(r);
            return (
              <Pressable
                key={r.domain}
                accessibilityRole="button"
                accessibilityLabel={`${r.domain}, ${ok ? 'Available' : 'Taken'}`}
                accessibilityState={{ disabled: !ok || flow.busy }}
                disabled={!ok || flow.busy}
                onPress={() => void buy(r.domain)}
                style={({ pressed }) => [st.row, pressed && ok && { opacity: 0.6 }]}
              >
                <Text style={[st.rowName, !ok && st.taken]}>{r.domain}</Text>
                <Text style={[st.badge, ok ? st.available : st.takenBadge]}>{ok ? 'Available' : 'Taken'}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      {flow.busy && <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />}
      {support && <Text style={[st.p, st.gap]}>{DOMAIN_SUPPORT_LINE}</Text>}
      {!!message && <Text style={[st.error, st.gap]}>{message}</Text>}
      <Text style={st.disclosure}>{DOMAIN_DISCLOSURE}</Text>
    </Page>
  );
}

const st = StyleSheet.create({
  h: { fontFamily: fonts.heading, fontSize: 22, color: colors.heading },
  p: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.body, marginTop: 6 },
  small: { fontFamily: fonts.body, fontSize: 12, color: colors.faint, marginTop: 8 },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
  gap: { marginTop: 14 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18 },
  input: {
    flex: 1, fontFamily: fonts.body, fontSize: 16, color: colors.text, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.ghostBorder,
  },
  list: { marginTop: 16 },
  row: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair,
  },
  rowName: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.text },
  taken: { color: colors.faint },
  badge: { fontFamily: fonts.bodyBold, fontSize: 12 },
  available: { color: '#22c55e' },
  takenBadge: { color: colors.faint },
  card: { marginTop: 8 },
  domain: { fontFamily: fonts.heading, fontSize: 24, color: colors.heading },
  state: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.accent, marginTop: 8 },
  disclosure: { fontFamily: fonts.body, fontSize: 12, lineHeight: 18, color: colors.faint, marginTop: 28 },
});
