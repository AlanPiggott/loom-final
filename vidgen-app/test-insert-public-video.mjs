import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '.env.local') });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function insertTestRender() {
  console.log('Fetching or creating test campaign...');

  // Try to get existing campaign
  let { data: campaigns, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, name')
    .limit(1);

  let campaign;

  if (campaignError) {
    console.error('Error fetching campaigns:', campaignError);
    return;
  }

  if (!campaigns || campaigns.length === 0) {
    console.log('No campaigns found. Creating test campaign...');

    // Get current user (we need to authenticate first)
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('Not authenticated. Please log in first at http://localhost:3000/login');
      console.error('Then re-run this script.');
      return;
    }

    // Create test campaign
    const { data: newCampaign, error: createError } = await supabase
      .from('campaigns')
      .insert({
        name: 'Test Campaign for Public Viewer',
        user_id: user.id
      })
      .select()
      .single();

    if (createError) {
      console.error('Error creating campaign:', createError);
      return;
    }

    // Create test scenes
    const { error: scenesError } = await supabase
      .from('scenes')
      .insert([
        {
          campaign_id: newCampaign.id,
          url: 'https://example.com',
          duration_sec: 30,
          order_index: 0
        },
        {
          campaign_id: newCampaign.id,
          url: 'https://google.com',
          duration_sec: 30,
          order_index: 1
        }
      ]);

    if (scenesError) {
      console.error('Error creating scenes:', scenesError);
      return;
    }

    campaign = newCampaign;
    console.log('✅ Test campaign created');
  } else {
    campaign = campaigns[0];
  }

  console.log(`Using campaign: ${campaign.name} (${campaign.id})`);

  // Insert test render
  console.log('\nInserting test render with public video...');

  const { data: render, error: renderError } = await supabase
    .from('renders')
    .insert({
      campaign_id: campaign.id,
      status: 'done',
      progress: 100,
      public_id: 'test-video-123',
      final_video_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      thumb_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
      duration_sec: 60
    })
    .select()
    .single();

  if (renderError) {
    console.error('Error inserting render:', renderError);
    return;
  }

  console.log('\n✅ Test render created successfully!');
  console.log('\nRender details:');
  console.log('  - ID:', render.id);
  console.log('  - Public ID:', render.public_id);
  console.log('  - Status:', render.status);
  console.log('  - Video URL:', render.final_video_url);
  console.log('  - Thumbnail:', render.thumb_url);
  console.log('\n🎥 Test the public viewer at:');
  console.log('  http://localhost:3000/v/test-video-123');
}

insertTestRender();
