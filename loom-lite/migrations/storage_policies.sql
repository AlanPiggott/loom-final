-- Storage Policies for Supabase Buckets
-- This creates the necessary RLS policies for storage buckets
-- Run this in Supabase SQL Editor if you want to keep RLS enabled

-- Note: You can also just disable RLS on the buckets in the dashboard
-- which is simpler if you don't need fine-grained access control

-- Policies for 'facecams' bucket
-- Allow authenticated users to upload facecams
CREATE POLICY "Authenticated users can upload facecams"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'facecams');

-- Allow everyone to view facecams (public access)
CREATE POLICY "Public can view facecams"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'facecams');

-- Allow authenticated users to update their facecams
CREATE POLICY "Authenticated users can update facecams"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'facecams')
WITH CHECK (bucket_id = 'facecams');

-- Allow authenticated users to delete facecams
CREATE POLICY "Authenticated users can delete facecams"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'facecams');

-- Policies for 'videos' bucket
-- Allow service role to upload videos (worker uses service role)
CREATE POLICY "Service role can upload videos"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'videos');

-- Allow everyone to view videos (public access)
CREATE POLICY "Public can view videos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'videos');

-- Policies for 'thumbnails' bucket
-- Allow service role to upload thumbnails (worker uses service role)
CREATE POLICY "Service role can upload thumbnails"
ON storage.objects FOR INSERT
TO service_role
WITH CHECK (bucket_id = 'thumbnails');

-- Allow everyone to view thumbnails (public access)
CREATE POLICY "Public can view thumbnails"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'thumbnails');

-- Optional: If you want authenticated users to also upload to videos/thumbnails
-- (useful for testing or direct uploads from the app)
CREATE POLICY "Authenticated users can upload videos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'videos');

CREATE POLICY "Authenticated users can upload thumbnails"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'thumbnails');

-- To check existing policies:
-- SELECT * FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage';

-- To remove all policies and disable RLS (simpler approach):
-- ALTER TABLE storage.objects DISABLE ROW LEVEL SECURITY;

-- To re-enable RLS:
-- ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;