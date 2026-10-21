import { Redirect } from 'expo-router';

/** The editor is the Edit tab now. Kept so old links still land. */
export default function EditorRedirect() {
  return <Redirect href="/edit" />;
}
