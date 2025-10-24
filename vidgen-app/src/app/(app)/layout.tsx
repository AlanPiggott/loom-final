import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Authenticated app shell - sidebar and topbar will be added by user */}
      <div className="flex h-screen">
        {/* Left sidebar placeholder */}
        <aside className="w-64 bg-white border-r border-gray-200">
          <div className="p-4">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              Sidebar
            </h2>
            <p className="text-xs text-gray-400 mt-1">
              Navigation will be added here
            </p>
          </div>
        </aside>

        {/* Main content area */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Top bar placeholder */}
          <header className="bg-white border-b border-gray-200 h-16 flex items-center px-6">
            <div className="flex-1">
              <h1 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
                Topbar
              </h1>
            </div>
            <div className="text-xs text-gray-400">
              User controls will be added here
            </div>
          </header>

          {/* Page content */}
          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}
