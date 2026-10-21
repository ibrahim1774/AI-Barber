import type { WebsiteData } from '@/web/types';
import { cleanText } from '@/lib/sections/text';

export type Member = NonNullable<WebsiteData['staff']>[number];
export interface MemberInput { name: string; role?: string; photo?: string }

function build(m: MemberInput): Member | null {
  const name = cleanText(m.name);
  if (!name) return null;
  const out: Member = { name };
  const role = cleanText(m.role ?? '');
  if (role) out.role = role;
  if (m.photo) out.photo = m.photo;
  return out;
}

export function addMember(d: WebsiteData, m: MemberInput): WebsiteData {
  const member = build(m);
  if (!member) return d;
  return { ...d, staff: [...(d.staff ?? []), member] };
}

export function updateMember(d: WebsiteData, i: number, m: MemberInput): WebsiteData {
  const staff = d.staff ?? [];
  const member = build(m);
  if (!member || i < 0 || i >= staff.length) return d;
  return { ...d, staff: staff.map((s, k) => (k === i ? member : s)) };
}

export function removeMember(d: WebsiteData, i: number): WebsiteData {
  const staff = d.staff ?? [];
  if (i < 0 || i >= staff.length) return d;
  return { ...d, staff: staff.filter((_, k) => k !== i) };
}

export function moveMember(d: WebsiteData, i: number, dir: -1 | 1): WebsiteData {
  const staff = d.staff ?? [];
  const j = i + dir;
  if (i < 0 || i >= staff.length || j < 0 || j >= staff.length) return d;
  const next = [...staff];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...d, staff: next };
}
