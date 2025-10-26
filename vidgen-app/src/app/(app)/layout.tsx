import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Script from 'next/script';
import Sidebar from '@/components/Sidebar';

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const supabase = createServerComponentClient({ cookies: () => cookieStore });
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <>
      {/* Material Icons */}
      <link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet" />

      <div className="flex h-screen font-display bg-gradient-to-br from-[#F8FAFC] via-gray-50 to-blue-50/30 text-[#334155] overflow-hidden">
        {/* Sidebar */}
        <Sidebar userEmail={user?.email || ''} />

        {/* Main content area */}
        <main className="flex-1 p-8 overflow-y-auto animate-fadeIn">
          {children}
        </main>
      </div>
    </>
  );
}
