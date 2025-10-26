import { Metadata } from 'next';
import { notFound } from 'next/navigation';

interface VideoData {
  public_id: string;
  final_video_url: string;
  thumb_url: string | null;
  duration_sec: number;
}

async function getVideoData(publicId: string): Promise<VideoData | null> {
  try {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SITE_URL}/api/v/${publicId}`,
      {
        cache: 'no-store', // Always fetch fresh data for public videos
      }
    );

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch (error) {
    console.error('[getVideoData] Error:', error);
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const video = await getVideoData(publicId);

  if (!video) {
    return {
      title: 'Video Not Found',
      description: 'The requested video could not be found.',
    };
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const videoUrl = `${siteUrl}/v/${video.public_id}`;

  return {
    title: 'VidGen Video',
    description: `Watch this personalized video created with VidGen`,
    openGraph: {
      title: 'VidGen Video',
      description: 'Watch this personalized video created with VidGen',
      url: videoUrl,
      type: 'video.other',
      videos: [
        {
          url: video.final_video_url,
          type: 'video/mp4',
        },
      ],
      images: video.thumb_url
        ? [
            {
              url: video.thumb_url,
              alt: 'Video thumbnail',
            },
          ]
        : [],
    },
    twitter: {
      card: 'player',
      title: 'VidGen Video',
      description: 'Watch this personalized video created with VidGen',
      players: [
        {
          playerUrl: videoUrl,
          streamUrl: video.final_video_url,
          width: 1280,
          height: 720,
        },
      ],
      images: video.thumb_url ? [video.thumb_url] : [],
    },
  };
}

export default async function PublicVideoPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  const video = await getVideoData(publicId);

  if (!video) {
    notFound();
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#F8FAFC] via-gray-50 to-blue-50/30">
      <div className="w-full max-w-4xl">
        {/* Video Player Card */}
        <div className="bg-white/70 backdrop-blur-sm rounded-2xl shadow-2xl overflow-hidden border border-[#E2E8F0]/50">
          {/* Video Player */}
          <div className="relative bg-black">
            <video
              src={video.final_video_url}
              controls
              poster={video.thumb_url ?? undefined}
              className="w-full"
              preload="metadata"
            >
              Your browser does not support the video tag.
            </video>
          </div>

          {/* Video Info */}
          <div className="p-6 bg-gradient-to-r from-[#F8FAFC] to-gray-50/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="flex items-center space-x-2">
                  <svg
                    className="h-8 w-8 text-[#0066FF]"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  <span className="text-xl font-bold text-[#334155]">VidGen</span>
                </div>
              </div>

              {/* Duration Badge */}
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-blue-50 to-blue-100/50 text-[#0066FF] border border-blue-200/50">
                {Math.floor(video.duration_sec / 60)}:
                {(video.duration_sec % 60).toString().padStart(2, '0')}
              </span>
            </div>

            {/* Description */}
            <p className="mt-4 text-sm text-[#64748B]">
              This personalized video was created with VidGen, the platform for automated
              video personalization at scale.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <a
            href="/"
            className="inline-flex items-center space-x-2 text-sm text-[#64748B] hover:text-[#0066FF] transition-colors"
          >
            <span>Create your own personalized videos</span>
            <span className="material-icons text-sm">arrow_forward</span>
          </a>
        </div>
      </div>
    </div>
  );
}
