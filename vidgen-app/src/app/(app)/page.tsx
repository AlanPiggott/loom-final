import { redirect } from 'next/navigation';

export default function AppRootPage() {
  // Redirect authenticated users from /app to /dashboard
  redirect('/dashboard');
}
