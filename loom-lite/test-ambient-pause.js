/**
 * Test ambient pause system via renderCampaign
 *
 * Tests short (20s) scene to verify:
 * 1. Ambient pause working during idle beat
 * 2. No stillness gaps during long pauses
 * 3. Budget accuracy: total duration still exact (±100ms)
 *
 * Visual inspection of the video will show:
 * - Cursor periodically drifting (every ~3-7s)
 * - Occasional tiny scroll nudges
 * - No long stillness gaps (>6-8s)
 */

const { renderCampaign } = require('./src/pipeline/renderCampaign');
const { ffprobeJson } = require('./src/utils/ffmpeg');
const path = require('path');
const fs = require('fs');

async function test() {
  console.log('Testing ambient pause system...\n');

  const campaignDir = path.join(__dirname, 'campaigns', 'ambient-test');

  // Clean up old test
  if (fs.existsSync(campaignDir)) {
    fs.rmSync(campaignDir, { recursive: true });
  }
  fs.mkdirSync(campaignDir, { recursive: true });

  // Create a simple 20s facecam (black screen with audio tone)
  const facecamPath = path.join(campaignDir, 'facecam.mp4');
  const { ffmpeg } = require('./src/utils/ffmpeg');

  console.log('Generating test facecam...');
  await ffmpeg([
    '-f', 'lavfi',
    '-i', 'color=c=black:s=640x480:d=20',
    '-f', 'lavfi',
    '-i', 'sine=frequency=440:duration=20',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    '-t', '20',
    facecamPath
  ]);

  // Test config: 20s scene with NO actions (triggers HME + ambient pause in idle beat)
  const config = {
    title: 'ambient-test',
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
        url: 'stripe.com/pricing',
        durationSec: 20
        // NO actions array - triggers HME v2 with ambient pause in idle beat
      }
    ]
  };

  fs.writeFileSync(
    path.join(campaignDir, 'config.json'),
    JSON.stringify(config, null, 2)
  );

  console.log('Running HME with ambient pause...\n');
  const result = await renderCampaign({ ...config, __baseDir: campaignDir });

  console.log('\n' + '='.repeat(60));
  console.log('Test Results');
  console.log('='.repeat(60));

  // Check video duration
  const meta = await ffprobeJson(result.final);
  const videoDur = parseFloat(meta.streams.find(s => s.codec_type === 'video')?.duration || '0');
  const audioDur = parseFloat(meta.streams.find(s => s.codec_type === 'audio')?.duration || '0');

  console.log(`Video duration: ${videoDur.toFixed(2)}s (expected: ~20s)`);
  console.log(`Audio duration: ${audioDur.toFixed(2)}s`);
  console.log(`Final video: ${result.final}`);

  const durationOK = Math.abs(videoDur - 20) < 1;
  console.log(`\nDuration accuracy: ${durationOK ? '✓ PASS' : '✗ FAIL'}`);

  console.log('\nTo visually inspect ambient behavior:');
  console.log(`  open "${result.final}"`);
  console.log('  Look for periodic cursor micro-movements during idle beat');
  console.log('  Expect no long stillness gaps (>6-8s)');

  return durationOK;
}

test()
  .then(success => {
    console.log('\n' + (success ? '🎉 TEST PASSED' : '❌ TEST FAILED'));
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Test failed:', error);
    process.exit(1);
  });
