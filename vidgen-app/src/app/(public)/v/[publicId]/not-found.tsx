export default function VideoNotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-[#F8FAFC] via-gray-50 to-blue-50/30">
      <div className="text-center max-w-md">
        <div className="mb-6">
          <svg
            className="mx-auto h-24 w-24 text-[#64748B]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </div>

        <h1 className="text-4xl font-bold text-[#334155] mb-4">Video Not Found</h1>
        <p className="text-lg text-[#64748B] mb-8">
          The video you're looking for doesn't exist or isn't ready yet.
        </p>

        <a
          href="/"
          className="inline-flex items-center space-x-2 px-6 py-3 bg-gradient-to-r from-[#0066FF] to-blue-600 text-white rounded-xl font-semibold shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200"
        >
          <span className="material-icons">home</span>
          <span>Go Home</span>
        </a>
      </div>
    </div>
  );
}
