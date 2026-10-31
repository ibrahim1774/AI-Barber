// Web stand-in for expo-tracking-transparency: there is no ATT prompt in a browser.
module.exports = {
  getTrackingPermissionsAsync: async () => ({ status: 'undetermined', granted: false, canAskAgain: false }),
  requestTrackingPermissionsAsync: async () => ({ status: 'denied', granted: false, canAskAgain: false }),
};
