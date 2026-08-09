import { createClient } from '@supabase/supabase-js';

/*
 * /api/tracking-ask — the analyst behind the /tracking chat.
 *
 * The browser sends the CURRENT view (the same campaign/adset/ad rollup on
 * screen, already filtered to the selected range) plus the question. We
 * never re-query Meta here: the operator is asking about what they are
 * looking at, and re-fetching would risk answering about different numbers
 * than the ones on their screen.
 *
 * Same admin gate as /api/tracking-data — this hands back revenue data.
 *
 * Env: ANTHROPIC_API_KEY.
 */

export const config = { maxDuration: 120 };

const ADMIN_EMAIL = 'ibrahim3709@gmail.com';
const MODEL = 'claude-sonnet-4-5';

interface AskRow {
  level: 'campaign' | 'adset' | 'ad';
  name: string;
  parent?: string;
  status?: string;
  spend: number;
  clicks: number;
  impressions: number;
  purchases: number;
  revenue: number;
  metaPurchases: number;
}

function table(rows: AskRow[]): string {
  const head = 'level | name | parent | status | spend | clicks | impr | purchases | revenue | meta_purch | cpa | roas';
  const body = rows.map((r) => {
    const cpa = r.purchases > 0 ? (r.spend / r.purchases).toFixed(2) : '-';
    const roas = r.spend > 0 ? (r.revenue / r.spend).toFixed(2) : '-';
    return [
      r.level, r.name, r.parent || '-', r.status || '-',
      r.spend.toFixed(2), r.clicks, r.impressions, r.purchases,
      r.revenue.toFixed(2), Math.round(r.metaPurchases), cpa, roas,
    ].join(' | ');
  });
  return [head, ...body].join('\n');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Server missing Supabase configuration' });

  const authHeader: string = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Not signed in' });

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: caller, error: authError } = await supabase.auth.getUser(token);
  if (authError || caller?.user?.email?.toLowerCase() !== ADMIN_EMAIL) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: 'Chat is not configured yet — add ANTHROPIC_API_KEY to this project\'s environment variables and redeploy.',
    });
  }

  const { question, rows, rangeLabel, totals, history } = (req.body || {}) as {
    question?: string;
    rows?: AskRow[];
    rangeLabel?: string;
    totals?: Record<string, number>;
    history?: { role: 'user' | 'assistant'; content: string }[];
  };
  if (!question || typeof question !== 'string') return res.status(400).json({ error: 'Missing question' });
  if (!Array.isArray(rows) || !rows.length) return res.status(400).json({ error: 'No ad data to analyse' });

  // Hard cap the context: a 90-day account can carry hundreds of ads, and
  // the useful signal is the spenders. Ordered by spend on the client.
  const capped = rows.slice(0, 300);

  const system = [
    'You are the in-house media buyer for aibarber.org, a $10-29/month website product for barbers.',
    'You are looking at Meta ads data joined to Stripe purchases.',
    '',
    'How to read the columns:',
    '- purchases/revenue are CLICK-VERIFIED: a real Stripe payment tied to that ad by click id. This is the floor, and the number to trust.',
    '- meta_purch is what Meta claims via its own cross-device attribution. Treat it as a ceiling, not truth.',
    '- cpa = spend/purchases, roas = revenue/spend. Revenue is FIRST-MONTH only — these are subscriptions, so an ad at 0.5x roas can still be profitable by month three. Say so when it matters instead of calling something a loser on month-one roas alone.',
    '- status is Meta delivery status; PAUSED rows spent while they were live.',
    '',
    'Answer like a colleague reading the same screen: lead with the finding, name the exact campaign/ad set/creative you mean, quote the numbers behind it, and say what you would do. Flag when a number is too small to act on (a single purchase is not a trend). Be concise — short paragraphs or tight bullets, no preamble, no restating the question.',
  ].join('\n');

  const userContent = [
    `Range on screen: ${rangeLabel || 'unknown'}`,
    totals
      ? `Totals: spend $${(totals.spend || 0).toFixed(2)}, ${totals.purchases || 0} purchases, $${(totals.revenue || 0).toFixed(2)} revenue, ${totals.clicks || 0} clicks`
      : '',
    '',
    'Data:',
    table(capped),
    rows.length > capped.length ? `\n(${rows.length - capped.length} lower-spend rows omitted)` : '',
    '',
    `Question: ${question}`,
  ].filter(Boolean).join('\n');

  const messages = [
    ...(Array.isArray(history) ? history.slice(-6) : []),
    { role: 'user' as const, content: userContent },
  ];

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, system, messages }),
    });
    const data: any = await resp.json();
    if (!resp.ok) {
      return res.status(502).json({ error: String(data?.error?.message || 'Analyst request failed').slice(0, 300) });
    }
    const answer = (data?.content || [])
      .filter((b: any) => b?.type === 'text')
      .map((b: any) => b.text)
      .join('\n')
      .trim();
    return res.status(200).json({ answer: answer || 'No answer returned.' });
  } catch (err: any) {
    return res.status(500).json({ error: String(err?.message || 'Analyst request failed').slice(0, 300) });
  }
}
