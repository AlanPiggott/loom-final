import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import RenderControls from './RenderControls';

interface Scene {
  id: string;
  url: string;
  duration_sec: number;
  order_index: number;
  entry_type?: 'manual' | 'csv' | null;
  csv_column?: string | null;
}

interface Campaign {
  id: string;
  name: string;
  created_at: string;
  lead_row_count?: number | null;
  lead_csv_filename?: string | null;
  lead_csv_url?: string | null;
}

interface Render {
  id: string;
  status: string;
  progress: number;
  public_id: string;
  final_video_url: string | null;
  thumb_url: string | null;
  error?: string | null;
  lead_row_index?: number | null;
  lead_identifier?: string | null;
  created_at?: string;
}

interface CampaignData {
  campaign: Campaign;
  scenes: Scene[];
  renders: Render[];
  latestRender: Render | null;
}

async function getCampaignData(id: string): Promise<CampaignData | null> {
  const cookieStore = await cookies();
  const supabase = createServerComponentClient({ cookies: () => cookieStore });

  // Check auth
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) {
    redirect('/login');
  }

  // Fetch from API
  const response = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/campaigns/${id}`, {
    headers: {
      Cookie: cookieStore.toString(),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return null;
  }

  return response.json();
}

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getCampaignData(id);

  if (!data) {
    notFound();
  }

  const { campaign, scenes, renders, latestRender } = data;

  return (
    <div className="animate-fadeIn">
      {/* Header */}
      <header className="mb-10 animate-slideDown">
        <h1 className="text-4xl font-bold text-[#334155] mb-2">{campaign.name}</h1>
        <p className="text-[#64748B]">
          Created {new Date(campaign.created_at).toLocaleDateString()}
        </p>
        {campaign.lead_row_count ? (
          <p className="text-[#64748B] mt-1">
            Lead list: {campaign.lead_row_count.toLocaleString()} rows
            {campaign.lead_csv_filename ? ` • ${campaign.lead_csv_filename}` : ''}
          </p>
        ) : null}
      </header>

      {/* Scenes Table */}
      <div className="mb-8 bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-[#E2E8F0]/50 overflow-hidden">
        <div className="p-6 border-b border-[#E2E8F0]/50">
          <h2 className="text-xl font-semibold text-[#334155]">Scenes</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gradient-to-r from-[#F8FAFC] to-gray-50/50 border-b border-[#E2E8F0]/50">
              <tr>
                <th className="px-6 py-4 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                  #
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                  URL
                </th>
                <th className="px-6 py-4 text-left text-xs font-semibold text-[#64748B] uppercase tracking-wider">
                  Duration
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E8F0]/30">
              {scenes.map((scene) => (
                <tr
                  key={scene.id}
                  className="hover:bg-gradient-to-r hover:from-blue-50/30 hover:to-transparent transition-all duration-200"
                >
                  <td className="px-6 py-4 text-sm text-[#64748B]">{scene.order_index + 1}</td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <a
                        href={scene.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-[#0066FF] hover:text-blue-600 hover:underline transition-colors break-words"
                      >
                        {scene.url}
                      </a>
                      {scene.entry_type === 'csv' && scene.csv_column && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium bg-orange-100 text-orange-700 border border-orange-200">
                          CSV column: {scene.csv_column}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-blue-50 to-blue-100/50 text-[#0066FF] border border-blue-200/50">
                      {scene.duration_sec}s
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-6 py-4 bg-gradient-to-r from-[#F8FAFC] to-gray-50/50 border-t border-[#E2E8F0]/50">
          <p className="text-sm text-[#64748B]">
            Total duration:{' '}
            <span className="font-semibold text-[#334155]">
              {scenes.reduce((sum, scene) => sum + scene.duration_sec, 0)}s
            </span>
          </p>
        </div>
      </div>

      {/* Render Controls */}
      <RenderControls
        campaignId={campaign.id}
        initialRenders={renders}
        leadRowCount={campaign.lead_row_count ?? 0}
      />
    </div>
  );
}
