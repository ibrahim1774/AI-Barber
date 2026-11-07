// Cookie definitions for the "stay signed in" refresh-token cookie. Shared by api/web-app/session.ts and the
// sign-in-link handler so both set exactly the same cookies. Tokens are never logged.
export const COOKIE = 'pb_rt';
export const COOKIE_PATH = '/api/web-app/session';
export const COOKIE_MAX_AGE = 400 * 24 * 60 * 60; // 400 days, the most browsers allow

// Non-HttpOnly hint so the client only asks for a restore when there is something to restore.
export const HINT = 'pb_has';
export const hintFor = () => `${HINT}=1; Secure; SameSite=Lax; Path=/; Max-Age=${COOKIE_MAX_AGE}`;
export const clearHint = () => `${HINT}=; Secure; SameSite=Lax; Path=/; Max-Age=0`;
const attrs = `HttpOnly; Secure; SameSite=Lax; Path=${COOKIE_PATH}`;
export const cookieFor = (token: string) => `${COOKIE}=${encodeURIComponent(token)}; ${attrs}; Max-Age=${COOKIE_MAX_AGE}`;
export const clearCookie = () => `${COOKIE}=; ${attrs}; Max-Age=0`;
