/**
 * Natural Mouse Path Generation
 *
 * Generates realistic mouse movement paths using:
 * - Cubic Bézier curves with perpendicular control point offset
 * - Minimum-jerk timing (s(u) = 10u³ - 15u⁴ + 6u⁵)
 * - Fitts' Law duration scaling
 * - Micro-jitter (decays to 0 at path end)
 * - Overshoot and correction
 */

/**
 * Minimum-jerk scalar for smooth timing
 * @param {number} u - Normalized time [0, 1]
 * @returns {number} Eased value [0, 1]
 */
function minJerk(u) {
  return 10 * u ** 3 - 15 * u ** 4 + 6 * u ** 5;
}

/**
 * Calculate movement duration using Fitts' Law
 * @param {number} distance - Euclidean distance in pixels
 * @param {number} targetWidth - Target width in pixels (default 80)
 * @param {number} a - Fitts constant a (default 120ms)
 * @param {number} b - Fitts constant b (default 150ms)
 * @returns {number} Duration in milliseconds
 */
function fittsDuration(distance, targetWidth = 80, a = 120, b = 150) {
  const ratio = Math.max(1, distance / targetWidth);
  return Math.max(a, a + b * Math.log2(1 + ratio));
}

/**
 * Sample cubic Bézier curve
 * @param {number} t - Parameter [0, 1]
 * @param {number} p0 - Start point
 * @param {number} p1 - Control point 1
 * @param {number} p2 - Control point 2
 * @param {number} p3 - End point
 * @returns {number} Interpolated value
 */
function cubicBezier(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return (
    u ** 3 * p0 +
    3 * u ** 2 * t * p1 +
    3 * u * t ** 2 * p2 +
    t ** 3 * p3
  );
}

/**
 * Generate low-frequency filtered noise for micro-jitter
 * @param {function} rand - Seeded RNG
 * @param {number} amplitude - Jitter amplitude in pixels (0.4-1.2)
 * @param {number} decay - Decay factor [0, 1] (1 = no jitter, 0 = full)
 * @returns {number} Jitter offset
 */
function microJitter(rand, amplitude, decay) {
  // Simple filtered noise (average of 3 samples for smoothing)
  const noise = (rand() + rand() + rand()) / 3 - 0.5;
  return noise * amplitude * (1 - decay);
}

/**
 * Generate natural mouse movement path from start to end
 * @param {Object} params - Path generation parameters
 * @param {number} params.fromX - Start X coordinate
 * @param {number} params.fromY - Start Y coordinate
 * @param {number} params.toX - End X coordinate
 * @param {number} params.toY - End Y coordinate
 * @param {number} params.targetWidth - Target element width (for Fitts' Law)
 * @param {function} params.rand - Seeded RNG function
 * @param {number} [params.sampleRate=90] - Sampling rate in Hz (60-120)
 * @param {boolean} [params.includeOvershoot=true] - Add overshoot + correction
 * @returns {Array<{x: number, y: number, t: number}>} Path coordinates with timestamps
 */
function generatePath({
  fromX,
  fromY,
  toX,
  toY,
  targetWidth,
  rand,
  sampleRate = 90,
  includeOvershoot = true
}) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.sqrt(dx ** 2 + dy ** 2);

  // Edge case: very short distance
  if (distance < 5) {
    return [
      { x: fromX, y: fromY, t: 0 },
      { x: toX, y: toY, t: 50 }
    ];
  }

  // Calculate duration using Fitts' Law
  const baseDuration = fittsDuration(distance, targetWidth);

  // Generate Bézier control points with perpendicular offset
  // Offset 2-8% of distance, random side
  const offsetRatio = 0.02 + rand() * 0.06; // 2-8%
  const offsetMagnitude = distance * offsetRatio;
  const perpAngle = Math.atan2(dy, dx) + Math.PI / 2; // 90 degrees
  const side = rand() > 0.5 ? 1 : -1;

  // Control point 1: 1/3 along path + perpendicular offset
  const cp1x = fromX + dx / 3 + Math.cos(perpAngle) * offsetMagnitude * side;
  const cp1y = fromY + dy / 3 + Math.sin(perpAngle) * offsetMagnitude * side;

  // Control point 2: 2/3 along path + perpendicular offset
  const cp2x = fromX + (2 * dx) / 3 + Math.cos(perpAngle) * offsetMagnitude * side * 0.7;
  const cp2y = fromY + (2 * dy) / 3 + Math.sin(perpAngle) * offsetMagnitude * side * 0.7;

  // Sample the path
  const path = [];
  const dt = 1000 / sampleRate; // milliseconds per sample
  const numSamples = Math.ceil(baseDuration / dt);

  const jitterAmplitude = 0.4 + rand() * 0.8; // 0.4-1.2 px

  for (let i = 0; i <= numSamples; i++) {
    const u = i / numSamples; // Normalized time [0, 1]
    const s = minJerk(u); // Eased time

    // Sample Bézier curve
    const x = cubicBezier(s, fromX, cp1x, cp2x, toX);
    const y = cubicBezier(s, fromY, cp1y, cp2y, toY);

    // Add micro-jitter (decays to 0 as u→1)
    const decay = u * u; // u² decay (faster at end)
    const jx = microJitter(rand, jitterAmplitude, decay);
    const jy = microJitter(rand, jitterAmplitude, decay);

    path.push({
      x: x + jx,
      y: y + jy,
      t: Math.round(u * baseDuration)
    });
  }

  // Add overshoot and correction
  if (includeOvershoot && distance > 20) {
    const overshootPx = 2 + rand() * 4; // 2-6 px
    const overshootAngle = Math.atan2(dy, dx);
    const overshootX = toX + Math.cos(overshootAngle) * overshootPx;
    const overshootY = toY + Math.sin(overshootAngle) * overshootPx;

    // Overshoot point
    path.push({
      x: overshootX,
      y: overshootY,
      t: baseDuration + 10
    });

    // Correction duration (80-120ms)
    const correctionDuration = 80 + rand() * 40;
    const correctionSamples = Math.ceil(correctionDuration / dt);

    for (let i = 1; i <= correctionSamples; i++) {
      const u = i / correctionSamples;
      const s = minJerk(u);

      path.push({
        x: overshootX + (toX - overshootX) * s,
        y: overshootY + (toY - overshootY) * s,
        t: baseDuration + 10 + Math.round(u * correctionDuration)
      });
    }
  }

  return path;
}

/**
 * Generate random idle movement path (small wandering)
 * @param {Object} params - Parameters
 * @param {number} params.centerX - Center X
 * @param {number} params.centerY - Center Y
 * @param {number} params.radius - Maximum wander radius
 * @param {function} params.rand - Seeded RNG
 * @returns {Array} Path coordinates
 */
function generateIdlePath({ centerX, centerY, radius, rand }) {
  const angle = rand() * Math.PI * 2;
  const r = rand() * radius;
  const toX = centerX + Math.cos(angle) * r;
  const toY = centerY + Math.sin(angle) * r;

  return generatePath({
    fromX: centerX,
    fromY: centerY,
    toX,
    toY,
    targetWidth: 60,
    rand,
    sampleRate: 60,
    includeOvershoot: false
  });
}

module.exports = {
  generatePath,
  generateIdlePath,
  fittsDuration,
  minJerk
};
