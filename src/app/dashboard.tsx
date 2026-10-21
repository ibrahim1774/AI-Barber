import { Redirect } from 'expo-router';

/** The old Dashboard: its job is now the Edit and Settings tabs. Kept so old links still land. */
export default function Dashboard() {
  return <Redirect href="/edit" />;
}
