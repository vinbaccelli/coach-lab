'use client';
import React, { useEffect, useState } from 'react';
import { lastSamBackend, mobileSamEnabled, showSamBackendLabel } from '@/lib/stroMotionDraft/mobileSamSwitch';

/** Test-build label: which Object-select model ran last (MobileSAM or SAM-2). Hidden on production. */
export function SamBackendBadge(): React.ReactElement | null {
  const show = showSamBackendLabel();
  const [b, setB] = useState(lastSamBackend());
  useEffect(() => {
    if (!show) return;
    const t = window.setInterval(() => setB(lastSamBackend()), 500);
    return () => window.clearInterval(t);
  }, [show]);
  if (!show) return null;
  const text = b === 'mobile' ? 'Model: MobileSAM' : b === 'sam2' ? 'Model: SAM-2' : `Model: not run yet (${mobileSamEnabled() ? 'MobileSAM first' : 'SAM-2 only'})`;
  return (
    <div aria-hidden style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 10100, pointerEvents: 'none', font: '600 11px system-ui', color: '#fff', background: 'rgba(0,0,0,0.7)', padding: '3px 7px', borderRadius: 6 }}>
      {text}
    </div>
  );
}
