import Storage from 'expo-sqlite/kv-store';

const key = (shopId: string) => `bookingsWizard.v1.${shopId}`;

/** Whether the first-run wizard has been finished (or left) for this shop. False when unreadable. */
export async function wizardDone(shopId: string): Promise<boolean> {
  try {
    return (await Storage.getItem(key(shopId))) === '1';
  } catch {
    return false;
  }
}

export async function markWizardDone(shopId: string): Promise<void> {
  try {
    await Storage.setItem(key(shopId), '1');
  } catch {
    // Worst case the wizard shows once more.
  }
}
