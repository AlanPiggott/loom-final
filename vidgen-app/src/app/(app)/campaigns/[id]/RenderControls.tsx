'use client';

import { useState, useEffect, useRef } from 'react';
import { toast } from 'sonner';

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

interface RenderControlsProps {
  campaignId: string;
  initialRenders: Render[];
  leadRowCount?: number;
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  recording: 'Recording',
  normalizing: 'Normalizing',
  concatenating: 'Concatenating',
  overlaying: 'Overlaying',
  uploading: 'Uploading',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  recording: 'bg-blue-100 text-blue-700 border-blue-200',
  normalizing: 'bg-purple-100 text-purple-700 border-purple-200',
  concatenating: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  overlaying: 'bg-pink-100 text-pink-700 border-pink-200',
  uploading: 'bg-orange-100 text-orange-700 border-orange-200',
  done: 'bg-green-100 text-green-700 border-green-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
};

export default function RenderControls({ campaignId, initialRenders, leadRowCount = 0 }: RenderControlsProps) {
  const [renders, setRenders] = useState<Render[]>(initialRenders);
  const [isRendering, setIsRendering] = useState(false);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setRenders(initialRenders);
  }, [initialRenders]);

  const stopPolling = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, []);

  const fetchRenders = async () => {
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/renders`);
      if (response.ok) {
        const data = await response.json();
        setRenders(data.renders || []);
      }
    } catch (error) {
      console.error('[RenderControls] Fetch renders error:', error);
    }
  };

  const startPolling = () => {
    if (pollIntervalRef.current) return;
    fetchRenders();
    pollIntervalRef.current = setInterval(fetchRenders, 3000);
  };

  const activeCount = renders.filter((render) => !['done', 'failed'].includes(render.status)).length;
  const hasActive = activeCount > 0;

  useEffect(() => {
    if (hasActive) {
      startPolling();
    } else {
      stopPolling();
      setIsRendering(false);
    }
  }, [hasActive]);

  const handleRender = async () => {
    setIsRendering(true);

    try {
      const response = await fetch(`/api/campaigns/${campaignId}/render`, {
        method: 'POST',
      });

      if (response.status === 409) {
        toast.warning('A render is already in progress.');
        setIsRendering(false);
        return;
      }

      const payload = await response.json();

      if (!response.ok) {
        toast.error(payload.error || 'Failed to start render');
        setIsRendering(false);
        return;
      }

      const queuedCount = Array.isArray(payload.renderIds) ? payload.renderIds.length : 1;
      toast.success(
        queuedCount > 1
          ? `Queued ${queuedCount} renders for your lead list`
          : 'Render queued successfully!'
      );

      await fetchRenders();
      startPolling();
    } catch (error) {
      console.error('[RenderControls] Render error:', error);
      toast.error('Failed to start render');
    } finally {
      setIsRendering(false);
    }
  };

  const completedCount = renders.filter((render) => render.status === 'done').length;
  const failedCount = renders.filter((render) => render.status === 'failed').length;
  const totalExpected = leadRowCount > 0 ? leadRowCount : Math.max(renders.length, leadRowCount);
  const buttonDisabled = isRendering || hasActive;

  const renderRows = renders;

  const formatDateTime = (value?: string | null) => {
    if (!value) return '—';
    try {
      return new Date(value).toLocaleString();
    } catch (error) {
      return value;
    }
  };

  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-lg border border-[#E2E8F0]/50 p-6">
      <h2 className="text-xl font-semibold text-[#334155] mb-4">Render</h2>

      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <div className="p-4 rounded-xl border border-[#E2E8F0]/60 bg-white shadow-sm">
          <p className="text-xs uppercase tracking-wide text-[#94A3B8] font-semibold">Completed</p>
          <p className="text-2xl font-bold text-[#334155] mt-1">
            {completedCount}
            {totalExpected ? ` / ${totalExpected}` : ''}
          </p>
        </div>
        <div className="p-4 rounded-xl border border-[#E2E8F0]/60 bg-white shadow-sm">
          <p className="text-xs uppercase tracking-wide text-[#94A3B8] font-semibold">In Progress</p>
          <p className="text-2xl font-bold text-[#334155] mt-1">{activeCount}</p>
        </div>
        <div className="p-4 rounded-xl border border-[#E2E8F0]/60 bg-white shadow-sm">
          <p className="text-xs uppercase tracking-wide text-[#94A3B8] font-semibold">Failed</p>
          <p className="text-2xl font-bold text-[#334155] mt-1">{failedCount}</p>
        </div>
      </div>

      <div className="overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead className="bg-gradient-to-r from-[#F8FAFC] to-gray-50/50 border-b border-[#E2E8F0]/50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase text-xs">Lead</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase text-xs">Identifier</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase text-xs">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase text-xs">Progress</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase text-xs">Video</th>
              <th className="px-4 py-3 text-left font-semibold text-[#64748B] uppercase text-xs">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E2E8F0]/40">
            {renderRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[#94A3B8]">
                  No renders yet. Launch a render to generate personalized videos.
                </td>
              </tr>
            ) : (
              renderRows.map((render) => {
                const leadIndex =
                  typeof render.lead_row_index === 'number' && render.lead_row_index >= 0
                    ? render.lead_row_index + 1
                    : null;
                const progressValue = render.progress ?? 0;
                const isActive = !['done', 'failed'].includes(render.status);

                return (
                  <tr key={render.id} className="hover:bg-blue-50/30 transition-colors">
                    <td className="px-4 py-3 text-[#334155] font-medium">
                      {leadIndex ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col">
                        <span className="text-[#334155] font-medium">
                          {render.lead_identifier || '—'}
                        </span>
                        {render.error && render.status === 'failed' && (
                          <span className="text-xs text-red-500 mt-1">{render.error}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${
                          STATUS_COLORS[render.status] || 'bg-gray-100 text-gray-700 border-gray-200'
                        }`}
                      >
                        {STATUS_LABELS[render.status] || render.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {isActive ? (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-[#64748B]">
                            <span>{progressValue}%</span>
                          </div>
                          <div className="w-full bg-gray-200 h-1.5 rounded-full overflow-hidden">
                            <div
                              className="bg-gradient-to-r from-[#0066FF] to-blue-600 h-1.5 rounded-full transition-all duration-300 ease-out"
                              style={{ width: `${progressValue}%` }}
                            />
                          </div>
                        </div>
                      ) : render.status === 'done' ? (
                        '100%'
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {render.status === 'done' && render.public_id ? (
                        <a
                          href={`/v/${render.public_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[#0066FF] hover:text-blue-600 font-medium"
                        >
                          <span className="material-icons text-base">play_circle</span>
                          View
                        </a>
                      ) : (
                        <span className="text-[#94A3B8]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[#64748B]">
                      {formatDateTime(render.created_at)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <button
        onClick={handleRender}
        disabled={buttonDisabled}
        className={`inline-flex items-center space-x-2 px-6 py-3 rounded-xl font-semibold shadow-lg transition-all duration-200 ${
          buttonDisabled
            ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
            : 'bg-gradient-to-r from-[#0066FF] to-blue-600 text-white hover:shadow-xl hover:scale-105'
        }`}
      >
        <span className="material-icons text-xl">
          {buttonDisabled ? 'hourglass_empty' : 'play_arrow'}
        </span>
        <span>{buttonDisabled ? 'Rendering...' : 'Start Render'}</span>
      </button>
    </div>
  );
}
