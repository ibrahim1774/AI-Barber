// The page an iOS customer's site is replaced with when their subscription
// lapses. Deliberately generic: no business name, no scripts, no tracking, no
// external assets. It also lacks publishSite's "published-at" marker, so it is
// never mistaken for a live customer site.
export function offlineHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Website unavailable</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    background: #0d0d0d;
    color: #f5f0e6;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px;
    box-sizing: border-box;
  }
  main { max-width: 32rem; flex: 1; display: flex; flex-direction: column; justify-content: center; }
  .bar { width: 48px; height: 3px; background: #f4a100; margin: 0 auto 24px; border-radius: 2px; }
  h1 { font-size: 1.75rem; line-height: 1.3; font-weight: 600; margin: 0 0 12px; }
  p { margin: 0; color: rgba(245, 240, 230, 0.6); font-size: 1rem; line-height: 1.5; }
  footer { font-size: 0.85rem; color: rgba(245, 240, 230, 0.5); padding-top: 24px; }
  footer a { color: #f4a100; text-decoration: none; }
</style>
</head>
<body>
<main>
  <div class="bar"></div>
  <h1>This website is no longer available</h1>
  <p>Please check back later.</p>
</main>
<footer><a href="https://www.aibarber.org">Built with Prime Barber</a></footer>
</body>
</html>
`;
}
