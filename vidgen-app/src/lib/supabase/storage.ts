import { supabaseServiceRole } from '@/lib/supabase/serviceRoleClient';

const FACECAM_BUCKET = 'facecams';
const LEAD_LIST_BUCKET = 'lead-lists';

/**
 * Upload a facecam video to Supabase Storage
 * @param file - The video file to upload
 * @param campaignId - The campaign ID (used for organizing files)
 * @returns The public URL of the uploaded file
 */
export async function uploadFacecam(file: File, campaignId: string): Promise<string> {
  if (!supabaseServiceRole) {
    throw new Error('Supabase service role client is not configured. Set SUPABASE_SERVICE_ROLE_KEY to enable uploads.');
  }
  // Generate a unique filename
  const timestamp = Date.now();
  const fileExt = file.name.split('.').pop() || 'mp4';
  const fileName = `${campaignId}/${timestamp}.${fileExt}`;

  // Convert File to ArrayBuffer then to Buffer
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Upload the file directly
  // Note: Bucket must be created manually in Supabase Dashboard
  const { data, error: uploadError } = await supabaseServiceRole.storage
    .from(FACECAM_BUCKET)
    .upload(fileName, buffer, {
      contentType: file.type || 'video/mp4',
      upsert: true,
    });

  if (uploadError) {
    console.error('[uploadFacecam] Upload error:', uploadError);
    throw new Error('Failed to upload facecam');
  }

  // Get the public URL
  const { data: { publicUrl } } = supabaseServiceRole.storage
    .from(FACECAM_BUCKET)
    .getPublicUrl(fileName);

  console.log('[uploadFacecam] Successfully uploaded:', publicUrl);
  return publicUrl;
}

/**
 * Upload a lead CSV file to Supabase Storage
 * @param file - The CSV file to upload
 * @param campaignId - Temporary campaign identifier used for foldering until the campaign is created
 * @returns Public URL and storage path of the uploaded CSV
 */
export async function uploadLeadCsv(
  file: File,
  campaignId: string
): Promise<{ publicUrl: string; path: string }> {
  if (!supabaseServiceRole) {
    throw new Error('Supabase service role client is not configured. Set SUPABASE_SERVICE_ROLE_KEY to enable uploads.');
  }
  const timestamp = Date.now();
  const fileExt = file.name.split('.').pop() || 'csv';
  const fileName = `${campaignId}/${timestamp}.${fileExt}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const { data, error: uploadError } = await supabaseServiceRole.storage
    .from(LEAD_LIST_BUCKET)
    .upload(fileName, buffer, {
      contentType: file.type || 'text/csv',
      upsert: true,
    });

  if (uploadError) {
    console.error('[uploadLeadCsv] Upload error:', uploadError);
    throw new Error('Failed to upload lead list CSV');
  }

  const {
    data: { publicUrl },
  } = supabaseServiceRole.storage.from(LEAD_LIST_BUCKET).getPublicUrl(fileName);

  console.log('[uploadLeadCsv] Successfully uploaded:', publicUrl);
  return { publicUrl, path: data?.path || fileName };
}

/**
 * Delete a facecam video from Supabase Storage
 * @param facecamUrl - The public URL of the facecam to delete
 */
export async function deleteFacecam(facecamUrl: string): Promise<void> {
  if (!supabaseServiceRole) {
    console.warn('[deleteFacecam] Service role client not configured; skipping delete');
    return;
  }
  // Extract the file path from the URL
  // URL format: https://xxx.supabase.co/storage/v1/object/public/facecams/campaign-id/timestamp.mp4
  const urlParts = facecamUrl.split('/');
  const bucketIndex = urlParts.indexOf(FACECAM_BUCKET);
  if (bucketIndex === -1) {
    console.warn('[deleteFacecam] Invalid facecam URL:', facecamUrl);
    return;
  }

  const filePath = urlParts.slice(bucketIndex + 1).join('/');

  const { error } = await supabaseServiceRole.storage
    .from(FACECAM_BUCKET)
    .remove([filePath]);

  if (error) {
    console.error('[deleteFacecam] Delete error:', error);
    // Don't throw - deletion failures shouldn't break the flow
  }
}
