// Native account persistence is unchanged. These browser-only functions are never called on iOS.
export async function readWebAccountSite(_uid: string): Promise<any> { throw new Error('web only'); }
export async function saveWebAccountSite(_site: any, _uid: string): Promise<number> { throw new Error('web only'); }

export function invalidateWebDraftReceipt() {}
