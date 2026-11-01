// Import the browser menu directly: Expo rewrites react-native imports before Metro's shim resolver runs.
const { ActionSheetIOS } = require('../../web-shims/react-native') as Pick<typeof import('react-native'), 'ActionSheetIOS'>;
export { ActionSheetIOS };
