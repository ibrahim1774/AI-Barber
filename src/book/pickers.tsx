import React, { useEffect, useState } from 'react';
import type { Api } from './api';
import { dateKey, formatDayLong, formatTime, monthGrid, monthKey, monthLabel, shiftMonth, todayKey, tzAbbrev } from './logic';
import type { Slot } from './types';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function DayPicker(p: {
  api: Api; slug: string; serviceId: string; memberId: string; tz: string;
  selected: string | null; onPick: (date: string) => void;
}) {
  const today = todayKey(p.tz);
  const [month, setMonth] = useState(monthKey(p.selected || today));
  const [days, setDays] = useState<Record<string, boolean> | null>(null);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    let live = true;
    setDays(null); setFailed(false);
    p.api.days(p.slug, p.serviceId, p.memberId, month)
      .then((r) => live && setDays(r.days))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [month, tries, p.slug, p.serviceId, p.memberId]);

  const cells = monthGrid(month, days || {}, today);
  const canPrev = month > monthKey(today);
  return (
    <div>
      <div className="cal-head">
        <button aria-label="Previous month" disabled={!canPrev} onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <strong aria-live="polite">{monthLabel(month)}</strong>
        <button aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>
      <div className="grid" role="grid" aria-label={monthLabel(month)}>
        {DOW.map((d, i) => <div className="dow" key={i} aria-hidden>{d}</div>)}
        {cells.map((c, i) => c
          ? <button key={c.date} className={'day' + (c.date === p.selected ? ' sel' : '')} disabled={!c.enabled || !days}
              aria-label={`${c.date}${c.enabled ? '' : ', unavailable'}`} onClick={() => p.onPick(c.date)}>{c.day}</button>
          : <div key={'p' + i} />)}
      </div>
      {!days && !failed && <p className="sub center" role="status">Loading days…</p>}
      {failed && <p className="err" role="alert">Couldn't load days. <button className="back" onClick={() => setTries(tries + 1)}>Retry</button></p>}
      {days && !Object.keys(days).length && <p className="sub center">No openings this month. Try the next one.</p>}
    </div>
  );
}

export function TimePicker(p: {
  api: Api; slug: string; serviceId: string; memberId: string; tz: string; date: string;
  onPick: (slot: Slot) => void;
}) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setSlots(null); setFailed(false);
    p.api.slots(p.slug, p.serviceId, p.memberId, p.date)
      .then((r) => live && setSlots(r.slots))
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [p.date, p.slug, p.serviceId, p.memberId]);

  return (
    <div>
      <p className="sub">{formatDayLong(p.date + 'T12:00:00Z', 'UTC')} · times in shop time{slots?.[0] ? ` (${tzAbbrev(slots[0].start, p.tz)})` : ''}</p>
      {!slots && !failed && <p className="spin" role="status">Loading times…</p>}
      {failed && <p className="err" role="alert">Couldn't load times. Go back and try again.</p>}
      {slots && !slots.length && <p className="note">No times left that day. Pick another day.</p>}
      {slots && <div className="times">
        {slots.map((s) => <button key={s.start + s.memberId} className="time" onClick={() => p.onPick(s)}>{formatTime(s.start, p.tz)}</button>)}
      </div>}
    </div>
  );
}

export { dateKey };
