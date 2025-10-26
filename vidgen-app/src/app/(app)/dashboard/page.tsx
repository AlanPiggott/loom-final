'use client';

import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import CampaignWizard from '@/components/CampaignWizard';

export default function DashboardPage() {
  const supabase = createClientComponentClient();
  const [user, setUser] = useState<any>(null);
  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
    };
    getUser();
  }, [supabase]);

  if (!user) return <div>Loading...</div>;

  // Extract first name from email
  const firstName = user?.email?.split('@')[0].split('.')[0];
  const capitalizedName = firstName
    ? firstName.charAt(0).toUpperCase() + firstName.slice(1)
    : 'Jane';

  return (
    <div className="animate-fadeIn">
        {/* Enhanced Header */}
        <header className="flex justify-between items-center mb-10 animate-slideDown">
          <div>
            <h1 className="text-4xl font-bold text-[#334155] tracking-tight mb-1">Dashboard</h1>
            <p className="text-[#64748B] text-base">Welcome back, <span className="font-semibold text-[#334155]">{capitalizedName}</span>. Let&apos;s create some magic. ✨</p>
          </div>
          <div className="flex items-center space-x-3">
            {/* Enhanced Help Link */}
            <Link href="#" className="flex items-center text-[#64748B] font-medium px-4 py-2 rounded-xl hover:bg-gray-100 hover:text-[#334155] transition-all duration-300 group">
              <span className="material-icons mr-2 transition-transform duration-300 group-hover:scale-110 text-[20px]">help_outline</span>
              Help &amp; Support
            </Link>
            {/* Enhanced New Campaign Button */}
            <button onClick={() => setWizardOpen(true)} type="button" className="bg-gradient-to-r from-[#0066FF] to-blue-600 text-white font-bold py-3 px-6 rounded-xl flex items-center shadow-lg shadow-[#0066FF]/30 hover:shadow-xl hover:shadow-[#0066FF]/40 transition-all duration-300 hover:scale-105 hover:-translate-y-0.5 active:scale-100 group">
              <span className="material-icons mr-2 transition-transform duration-300 group-hover:rotate-90 text-[20px]">add</span>
              New Campaign
            </button>
          </div>
        </header>

        {/* Enhanced Hero/CTA Section */}
        <div className="relative bg-white border-2 border-dashed border-[#E2E8F0] rounded-2xl p-12 text-center mb-8 shadow-xl transition-all duration-300 overflow-hidden group animate-slideUp">
          {/* Decorative background elements */}
          <div className="absolute inset-0 bg-gradient-to-t from-gray-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

          <div className="relative z-10">
            <h2 className="text-3xl font-bold mb-3 text-[#334155] tracking-tight">Create Your First Campaign</h2>
            <p className="text-[#64748B] mb-8 text-lg max-w-2xl mx-auto leading-relaxed">Ready to launch? Start by uploading a prospect list to generate your personalized videos.</p>
            <button onClick={() => setWizardOpen(true)} type="button" className="bg-gradient-to-r from-[#0066FF] to-blue-600 text-white font-bold py-4 px-8 rounded-xl flex items-center mx-auto shadow-2xl shadow-[#0066FF]/30 hover:shadow-[#0066FF]/50 transition-all duration-300 hover:scale-110 hover:-translate-y-1 active:scale-105 group/btn">
              <span className="material-icons mr-3 text-2xl transition-transform duration-300 group-hover/btn:rotate-90">add_circle</span>
              <span className="text-lg">Start New Campaign</span>
            </button>
          </div>
        </div>

        {/* Enhanced Activity Table */}
        <div className="animate-slideUp" style={{ animationDelay: '0.6s' }}>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-[#334155] tracking-tight">Recent Activity</h2>

            {/* Search and Filter Controls */}
            <div className="flex items-center space-x-4">
              {/* Search Input */}
              <div className="relative">
                <span className="material-icons absolute left-3 top-1/2 transform -translate-y-1/2 text-[#64748B] text-lg">search</span>
                <input type="text" placeholder="Search campaigns..." className="pl-10 pr-4 py-2 bg-white border border-[#E2E8F0] rounded-xl text-sm text-[#334155] placeholder-[#64748B] focus:outline-none focus:ring-2 focus:ring-[#0066FF]/50 focus:border-[#0066FF] transition-all duration-300 w-64 shadow-sm"/>
              </div>

              {/* Active Only Filter */}
              <label className="flex items-center cursor-pointer px-4 py-2 bg-white border border-[#E2E8F0] rounded-xl hover:bg-gray-50 transition-all duration-300 shadow-sm">
                <input type="checkbox" className="form-checkbox h-4 w-4 text-[#0066FF] rounded border-gray-300 focus:ring-2 focus:ring-[#0066FF]/50 transition-all duration-300"/>
                <span className="ml-2 text-sm font-medium text-[#334155]">Active only</span>
              </label>
            </div>
          </div>

          <div className="bg-gradient-to-br from-white to-gray-50/50 rounded-2xl shadow-xl border border-[#E2E8F0]/50 overflow-hidden">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100/50">
                <tr>
                  <th className="p-6 text-left text-xs font-bold text-[#64748B] uppercase tracking-widest">Campaign</th>
                  <th className="p-6 text-left text-xs font-bold text-[#64748B] uppercase tracking-widest">Videos</th>
                  <th className="p-6 text-left text-xs font-bold text-[#64748B] uppercase tracking-widest">Status</th>
                  <th className="p-6 text-left text-xs font-bold text-[#64748B] uppercase tracking-widest">Date</th>
                  <th className="p-6 text-center text-xs font-bold text-[#64748B] uppercase tracking-widest">Active</th>
                  <th className="p-6"></th>
                </tr>
              </thead>
              <tbody>
                {/* Row 1 - Completed campaign */}
                <tr className="border-b border-[#E2E8F0]/50 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all duration-300 group">
                  <td className="p-6">
                    <Link href="#" className="font-bold text-[#334155] hover:text-[#0066FF] transition-colors duration-300 flex items-center group/link">
                      Q4 Outreach - Tech Leads
                      <span className="material-icons text-sm ml-1 opacity-0 group-hover/link:opacity-100 transition-opacity duration-300">arrow_forward</span>
                    </Link>
                  </td>
                  <td className="p-6">
                    <span className="text-sm font-semibold text-[#334155]">150</span>
                  </td>
                  <td className="p-6">
                    <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-semibold bg-green-100 text-green-700">
                      Completed
                    </span>
                  </td>
                  <td className="p-6 text-sm font-medium text-[#64748B]">Oct 15, 2025</td>
                  <td className="p-6">
                    <div className="flex justify-center">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" defaultChecked className="sr-only peer"/>
                        <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#0066FF]/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-green-500 peer-checked:to-emerald-500 shadow-inner"></div>
                      </label>
                    </div>
                  </td>
                  <td className="p-6 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button className="text-[#64748B] hover:text-[#0066FF] hover:bg-[#0066FF]/10 p-2 rounded-lg transition-all duration-300 hover:scale-110">
                        <span className="material-icons text-lg">visibility</span>
                      </button>
                      <button className="text-[#64748B] hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition-all duration-300 hover:scale-110">
                        <span className="material-icons text-lg">delete_outline</span>
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Row 2 - In Progress */}
                <tr className="border-b border-[#E2E8F0]/50 hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all duration-300 group">
                  <td className="p-6">
                    <Link href="#" className="font-bold text-[#334155] hover:text-[#0066FF] transition-colors duration-300 flex items-center group/link">
                      New LinkedIn Connections
                      <span className="material-icons text-sm ml-1 opacity-0 group-hover/link:opacity-100 transition-opacity duration-300">arrow_forward</span>
                    </Link>
                  </td>
                  <td className="p-6">
                    <span className="text-sm font-semibold text-[#334155]">200</span>
                  </td>
                  <td className="p-6">
                    <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-semibold bg-blue-100 text-blue-700">
                      In Progress
                    </span>
                  </td>
                  <td className="p-6 text-sm font-medium text-[#64748B]">Oct 17, 2025</td>
                  <td className="p-6">
                    <div className="flex justify-center">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" defaultChecked className="sr-only peer"/>
                        <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#0066FF]/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-green-500 peer-checked:to-emerald-500 shadow-inner"></div>
                      </label>
                    </div>
                  </td>
                  <td className="p-6 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button className="text-[#64748B] hover:text-[#0066FF] hover:bg-[#0066FF]/10 p-2 rounded-lg transition-all duration-300 hover:scale-110">
                        <span className="material-icons text-lg">visibility</span>
                      </button>
                      <button className="text-[#64748B] hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition-all duration-300 hover:scale-110">
                        <span className="material-icons text-lg">delete_outline</span>
                      </button>
                    </div>
                  </td>
                </tr>

                {/* Row 3 - Paused */}
                <tr className="hover:bg-gradient-to-r hover:from-gray-50 hover:to-transparent transition-all duration-300 group">
                  <td className="p-6">
                    <Link href="#" className="font-bold text-[#334155] hover:text-[#0066FF] transition-colors duration-300 flex items-center group/link">
                      Follow-up Sequence
                      <span className="material-icons text-sm ml-1 opacity-0 group-hover/link:opacity-100 transition-opacity duration-300">arrow_forward</span>
                    </Link>
                  </td>
                  <td className="p-6">
                    <span className="text-sm font-semibold text-[#334155]">50</span>
                  </td>
                  <td className="p-6">
                    <span className="inline-flex items-center px-3 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700">
                      Paused
                    </span>
                  </td>
                  <td className="p-6 text-sm font-medium text-[#64748B]">Oct 10, 2025</td>
                  <td className="p-6">
                    <div className="flex justify-center">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" className="sr-only peer"/>
                        <div className="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-[#0066FF]/50 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-gradient-to-r peer-checked:from-green-500 peer-checked:to-emerald-500 shadow-inner"></div>
                      </label>
                    </div>
                  </td>
                  <td className="p-6 text-right">
                    <div className="flex items-center justify-end space-x-2">
                      <button className="text-[#64748B] hover:text-[#0066FF] hover:bg-[#0066FF]/10 p-2 rounded-lg transition-all duration-300 hover:scale-110">
                        <span className="material-icons text-lg">visibility</span>
                      </button>
                      <button className="text-[#64748B] hover:text-red-500 hover:bg-red-50 p-2 rounded-lg transition-all duration-300 hover:scale-110">
                        <span className="material-icons text-lg">delete_outline</span>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

      {/* Campaign Wizard Modal */}
      <CampaignWizard isOpen={wizardOpen} onClose={() => setWizardOpen(false)} />
    </div>
  );
}
