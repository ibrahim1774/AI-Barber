import { Alert, Platform } from 'react-native';

// react-native-web leaves Alert.alert empty, so every confirmation and error message in the app would silently vanish
// in a browser. On web, route it to the browser's own dialogs: a message with one button is an alert; with several it is a
// confirm where OK runs the first non-cancel button and Cancel runs the cancel button.
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  type Btn = { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: (value?: string) => void };
  Alert.alert = (title: string, message?: string, buttons?: Btn[]) => {
    const text = [title, message].filter(Boolean).join('\n\n');
    const list = buttons ?? [];
    const actions = list.filter((b) => b.style !== 'cancel');
    const cancel = list.find((b) => b.style === 'cancel');
    if (list.length <= 1) {
      window.alert(text);
      list[0]?.onPress?.();
      return;
    }
    if (window.confirm(text)) actions[0]?.onPress?.();
    else cancel?.onPress?.();
  };
}
