// Web stand-in for react-native-appsflyer: no-ops.
const noop = async () => {};
const AF = new Proxy({}, { get: () => noop });
module.exports = AF; module.exports.default = AF;
