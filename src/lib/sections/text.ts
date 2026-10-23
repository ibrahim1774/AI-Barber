/**
 * Text typed into a section editor, made safe for the site templates: Design 1
 * prints some fields (service titles, team names) without escaping, so `<` and
 * `>` would break the published page.
 */
export function cleanText(s: string): string {
  return straightenQuotes(s).replace(/[<>]/g, '').trim();
}

/**
 * iOS "smart punctuation" turns a typed ' into ’. The site (header, hero) prints the straight one, so a name
 * typed as "Jack's" would read differently in the editor sheets than on the page: keep the straight quote.
 */
export function straightenQuotes(s: string): string {
  return s.replace(/[\u2018\u2019]/g, "'");
}
