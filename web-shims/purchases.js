// Web stand-in for react-native-purchases (RevenueCat): no-ops.
const noop = async () => {};
const Purchases = new Proxy({}, { get: () => noop });
module.exports = Purchases; module.exports.default = Purchases;
module.exports.PURCHASES_ARE_COMPLETED_BY_TYPE = { MY_APP: 'MY_APP' };
module.exports.STOREKIT_VERSION = { STOREKIT_2: 'STOREKIT_2' };
