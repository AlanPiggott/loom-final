const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function insertTestRender() {
  console.log('Fetching existing campaigns...');

  // Get first campaign
  const { data: campaigns, error: campaignError } = await supabase
    .from('campaigns')
    .select('id, name')
    .limit(1);

  if (campaignError) {
    console.error('Error fetching campaigns:', campaignError);
    return;
  }

  if (!campaigns || campaigns.length === 0) {
    console.error('No campaigns found. Please create a campaign first via the wizard.');
    return;
  }

  const campaign = campaigns[0];
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
