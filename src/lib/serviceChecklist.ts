import { SERVICE_CHOICES, checklistToServices, type ServicePicks } from '@/web/lib/stockImages';

export { SERVICE_CHOICES, checklistToServices, type ServicePicks };

/** Ticks or unticks a service; an unticked one keeps its typed price (ticking it again brings it back). */
export function togglePick(picks: ServicePicks, title: string): ServicePicks {
  const cur = picks[title];
  return { ...picks, [title]: { ...cur, on: !cur?.on } };
}

/** Sets a service's price; typing a price ticks it. */
export function setPickPrice(picks: ServicePicks, title: string, price: string): ServicePicks {
  return { ...picks, [title]: { on: price.trim() ? true : !!picks[title]?.on, price } };
}

export function tickedCount(picks: ServicePicks): number {
  return SERVICE_CHOICES.filter((t) => picks[t]?.on).length;
}

/** The services to pass on: undefined when nothing is ticked (generateContent then makes no Services section). */
export function servicesFromPicks(picks: ServicePicks): { title: string; price?: string }[] | undefined {
  const list = checklistToServices(picks);
  return list.length ? list : undefined;
}

/** The services a Google-listing site starts with: titles only, no prices, all editable in the editor. */
export const GOOGLE_DEFAULT_SERVICES: { title: string }[] = ['Haircut', 'Skin fade', 'Beard trim', 'Line up', 'Kids cut'].map((title) => ({ title }));
