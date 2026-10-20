let n = 0;
export function randomUUID() {
  n += 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}
