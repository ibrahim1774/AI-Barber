import { Redirect } from 'expo-router';

// Later tasks route to the dashboard when a site exists.
export default function Index() {
  return <Redirect href="/start" />;
}
