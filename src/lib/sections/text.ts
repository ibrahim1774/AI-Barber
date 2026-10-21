/**
 * Text typed into a section editor, made safe for the site templates: Design 1
 * prints some fields (service titles, team names) without escaping, so `<` and
 * `>` would break the published page.
 */
export function cleanText(s: string): string {
  return s.replace(/[<>]/g, '').trim();
}
