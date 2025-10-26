'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface SidebarProps {
  userEmail: string;
}

export default function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname();

  const navItems = [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { href: '/campaigns', label: 'Campaigns', icon: 'campaign' },
    { href: '/integrations', label: 'Integrations', icon: 'integration_instructions' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
  ];

  // Extract name from email (first part before @)
  const userName = userEmail.split('@')[0].split('.').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');

  return (
    <aside className="w-64 bg-gradient-to-b from-white to-gray-50/50 flex flex-col p-5 border-r border-[#E2E8F0]/50 shadow-xl animate-slideInLeft">
      {/* Logo with glow effect */}
      <div className="flex items-center space-x-2 p-3 mb-10 group">
        <div className="relative">
          <svg className="h-9 w-9 text-[#0066FF] transition-all duration-300 group-hover:scale-110" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.01 14.01L7.5 12.5l1.41-1.41 2.09 2.08 4.6-4.6L17.01 10l-6.02 6.01z" opacity="0.3"></path>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2.01-8.5l-2.09 2.09 1.41 1.41 2.09-2.09 4.6-4.6-1.41-1.41-4.6 4.6z"></path>
          </svg>
          <div className="absolute inset-0 bg-[#0066FF]/20 rounded-full blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
        </div>
        <span className="text-2xl font-bold text-[#334155] tracking-tight">VidGen</span>
      </div>

      {/* Enhanced Navigation */}
      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const isActive = pathname === item.href;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`
                flex items-center p-3 rounded-xl font-semibold transition-all duration-300 hover:-translate-y-0.5 group
                ${isActive
                  ? 'bg-gradient-to-r from-[#0066FF] to-blue-600 text-white shadow-lg shadow-[#0066FF]/30 ring-2 ring-[#0066FF]/20 ring-offset-2 ring-offset-[#F8FAFC] hover:scale-[1.02] hover:shadow-xl'
                  : 'text-[#64748B] hover:bg-gradient-to-r hover:from-gray-100 hover:to-gray-50 hover:text-[#334155] hover:shadow-md'
                }
              `}
            >
              <span className="material-icons mr-3 transition-transform duration-300 group-hover:scale-110">
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Enhanced User Profile Card */}
      <div className="mt-auto">
        <div className="bg-gradient-to-br from-gray-100 to-gray-50 p-3 rounded-xl shadow-lg hover:shadow-xl transition-all duration-300 flex items-center justify-between cursor-pointer hover:-translate-y-1 group border border-[#E2E8F0]/30">
          <div className="flex items-center flex-1">
            <img
              alt={`${userName}'s avatar`}
              className="w-10 h-10 rounded-full mr-3 ring-2 ring-[#0066FF]/20 group-hover:ring-[#0066FF]/40 transition-all duration-300"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDgtFSAMjI1OMobS9YuS53VVD8IrSoBH5K8m4KI4BNplzapPFrpuyEgpIQ9iNcn1GVUiaiNG_aslTzQme-6ZxQEg-pXGMcY2RUAvUdlZPh-9bVnAZQrRzn8-G90i05VOKirR9y4SDk8HSssMnXA8J5rfG7mXi-HsPcqBQrTqzmhGNOmk2ER-WEZa62EY5re6lj9_2Y5X6h5vcKpDtJoVTlrxgIprUqzjkpMNbw2mNNMbbZky-r3DXYHQY6aVqtXjLCmtQsMTQm3Z58"
            />
            <div>
              <p className="font-bold text-sm text-[#334155] leading-tight">{userName}</p>
              <p className="text-xs text-[#64748B] mt-0.5">{userEmail}</p>
            </div>
          </div>
          <span className="material-icons text-[#64748B] group-hover:translate-x-1 transition-transform duration-300">
            arrow_forward
          </span>
        </div>
      </div>
    </aside>
  );
}
