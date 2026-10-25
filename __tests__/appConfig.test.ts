import app from '../app.json';

const expo = app.expo as any;

describe('app.json privacy and permissions', () => {
  it('declares tracking consistently with the ATT prompt and ASC', () => {
    const pm = expo.ios.privacyManifests;
    expect(pm.NSPrivacyTracking).toBe(true);
    expect(pm.NSPrivacyTrackingDomains).toEqual(
      expect.arrayContaining(['appsflyersdk.com', 'appsflyer-skadnetwork.com']),
    );
    const att = expo.plugins.find((p: any) => Array.isArray(p) && p[0] === 'expo-tracking-transparency');
    expect(att[1].userTrackingPermission).toBeTruthy();
  });

  it('does not request the microphone', () => {
    const picker = expo.plugins.find((p: any) => Array.isArray(p) && p[0] === 'expo-image-picker');
    expect(picker[1].microphonePermission).toBe(false);
  });
});
