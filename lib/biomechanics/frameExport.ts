import type { PhaseMeasurements } from '@/lib/biomechanics/types';

function fmt(n: number | null | undefined, suffix = '°'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n}${suffix}`;
}

export function renderMeasurementCard(
  videoFrame: CanvasImageSource,
  frameW: number,
  frameH: number,
  measurement: PhaseMeasurements,
): string {
  const panelW = Math.min(280, Math.round(frameW * 0.42));
  const canvas = document.createElement('canvas');
  canvas.width = frameW + panelW;
  canvas.height = frameH;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  ctx.fillStyle = '#0a0a0c';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(videoFrame, 0, 0, frameW, frameH);

  ctx.fillStyle = 'rgba(8, 10, 14, 0.92)';
  ctx.fillRect(frameW, 0, panelW, frameH);

  ctx.fillStyle = '#fff';
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(measurement.phaseLabel, frameW + 14, 24);
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`@ ${measurement.timeSec.toFixed(2)}s`, frameW + 14, 42);

  const lines = [
    'Joint Angles',
    `L Elbow ${fmt(measurement.jointAngles.leftElbowDeg)}`,
    `R Elbow ${fmt(measurement.jointAngles.rightElbowDeg)}`,
    `L Knee ${fmt(measurement.jointAngles.leftKneeDeg)}`,
    `R Knee ${fmt(measurement.jointAngles.rightKneeDeg)}`,
    `Shoulder–Hip ${fmt(measurement.shoulderHipSeparationDeg)}`,
    `Racket ${fmt(measurement.racketAngleDeg)}`,
    measurement.stringbedDirection.available
      ? `Stringbed ${fmt(measurement.stringbedDirection.degrees)}`
      : 'Stringbed —',
    `Balance lat ${fmt(measurement.balance.lateralComOffsetNormalized, '× SW')}`,
  ];

  ctx.fillStyle = 'rgba(255,255,255,0.88)';
  ctx.font = '11px system-ui, sans-serif';
  let y = 64;
  for (const line of lines) {
    if (line === 'Joint Angles') {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.font = '600 10px system-ui, sans-serif';
    } else {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = '11px system-ui, sans-serif';
    }
    ctx.fillText(line, frameW + 14, y);
    y += line === 'Joint Angles' ? 16 : 18;
  }

  return canvas.toDataURL('image/png');
}
