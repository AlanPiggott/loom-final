/**
 * Test 5-minute maximum campaign duration enforcement
 */

const { renderCampaign } = require('./src/pipeline/renderCampaign');
const { ffmpeg } = require('./src/utils/ffmpeg');
const path = require('path');
const fs = require('fs');

async function test() {
  console.log('Testing 5-minute max campaign duration enforcement...\n');

  const campaignDir = path.join(__dirname, 'campaigns', 'max-duration-test');

  // Clean up old test
  if (fs.existsSync(campaignDir)) {
    fs.rmSync(campaignDir, { recursive: true });
  }
  fs.mkdirSync(campaignDir, { recursive: true });

  // Create a 6-minute (360s) facecam (exceeds 5-minute limit)
  const facecamPath = path.join(campaignDir, 'facecam.mp4');
  console.log('Generating 6-minute test facecam (should fail validation)...');

  await ffmpeg([
    '-f', 'lavfi',
    '-i', 'color=c=black:s=640x480:d=360',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=360',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-t', '360',
    facecamPath
  ]);

  // Test config: 6-minute campaign (360s) - should fail
  const config = {
    title: 'max-duration-test',
    output: {
      width: 1280,
      height: 720,
      fps: 30,
      facecam: {
        path: './facecam.mp4',
        pip: { width: 230, margin: 24, corner: 'bottom-right' },
        endPadMode: 'freeze'
      }
    },
    scenes: [
      {
        id: 'scene-1',
        url: 'example.com',
        durationSec: 360 // 6 minutes - exceeds 5-minute limit
      }
    ]
  };

  fs.writeFileSync(
    path.join(campaignDir, 'config.json'),
    JSON.stringify(config, null, 2)
  );

  console.log('Attempting to render 6-minute campaign (should fail)...\n');

  try {
    await renderCampaign({ ...config, __baseDir: campaignDir });
    console.log('\n❌ TEST FAILED: Expected error but render succeeded');
    process.exit(1);
  } catch (error) {
    // Should fail with duration limit error
    if (error.message.includes('exceeds maximum 300s')) {
      console.log('✓ Correctly rejected 6-minute campaign');
      console.log('Error message:', error.message);
      console.log('\n🎉 TEST PASSED');
      process.exit(0);
    } else {
      console.log('\n❌ TEST FAILED: Wrong error message');
      console.log('Expected: "exceeds maximum 300s"');
      console.log('Got:', error.message);
      process.exit(1);
    }
  }
}

test().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
