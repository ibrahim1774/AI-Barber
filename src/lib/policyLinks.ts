/**
 * The in-app Privacy, Terms and Support pages. `?app=1` tells the site to hide its nav and the footer "Home" link
 * to the web builder, so the app never leads to buying outside in-app purchase (App Store 3.1.1 / 3.1.3).
 */
const ORIGIN = 'https://www.aibarber.org';
export const PRIVACY_URL = `${ORIGIN}/privacy?app=1`;
export const TERMS_URL = `${ORIGIN}/terms?app=1`;
export const SUPPORT_URL = `${ORIGIN}/support?app=1`;
