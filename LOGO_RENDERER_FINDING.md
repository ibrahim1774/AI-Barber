# Logo renderer findings (src/web is vendored; not edited)

Verified by __tests__/logoSite.test.tsx: all three designs print the header logo with intrinsic width/height, a fixed
fluid height (clamp 36-56px), width:auto, max-width:min(55vw,240px), object-fit:contain, escaped alt. Wide, tall, square
and tiny logos therefore never distort or overflow. Logos over 20:1 fall back to the shop name.

Residual, renderer-only:
1. A 40x40 logo is displayed at 36-56px (up to 1.4x upscale, slightly soft). Optional: add `max-height:Npx` using
   the intrinsic height, e.g. style="height:min(<h>px, clamp(...))". Minor.
2. Dark logo on the dark header (prime/euphoria headers are near-black; luxe too) or a light logo on a light header is
   not handled: the PNG is shown as is. Proposed CSS on the logo `<a>`/img wrapper for a readable fallback:
   `.ab-logo img{background:rgba(255,255,255,.92);padding:4px 8px;border-radius:8px}` behind an owner toggle
   ("Logo background: none / light"), or `filter` is not safe for colour logos. Needs a new data flag (e.g. logo.plate)
   on the server, so it is a product decision.
