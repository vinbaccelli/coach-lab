'use client';

/**
 * The guided tours as every screen mounts them.
 *
 * The engine (components/GuidedTourEngine.tsx, with the tour data and step
 * pictures) is loaded and mounted only while the tours switch is on
 * (lib/toursSwitch.ts). Off, this renders nothing and the engine's code is
 * never downloaded.
 */

import dynamic from 'next/dynamic';
import { useToursEnabled } from '@/lib/useToursEnabled';
import type { GuidedTourProps } from '@/components/GuidedTourEngine';

const GuidedTourEngine = dynamic(() => import('@/components/GuidedTourEngine'), { ssr: false });

export default function GuidedTour(props: GuidedTourProps) {
  const enabled = useToursEnabled();
  return enabled ? <GuidedTourEngine {...props} /> : null;
}
