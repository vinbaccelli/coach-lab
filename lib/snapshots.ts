/**
 * Snapshot model — the single source of truth for Metrics analysis state.
 *
 * Each Snapshot is one analysis state anchored at a video timestamp (the green
 * ball on the timeline). It owns everything for that frame: the data column,
 * drawings, measurement overlays, overlay adjustments, and (after Generate) a
 * captured screenshot. Switching snapshots restores the full UI state.
 *
 * Snapshots are created ONLY by AI Detect or the Phases picker. Skeleton and
 * Draw tools modify the active snapshot; they never create one.
 */

export interface SnapshotMeasurement {
  id: string;
  label: string;
  value: number;
  unit: string;
  type: string;
}

export interface OverlayAdjustment {
  dx1: number;
  dy1: number;
  dx2: number;
  dy2: number;
}

export interface SnapshotKeypoint {
  x: number;
  y: number;
  score: number;
  name: string;
}

export interface Snapshot {
  id: string;
  timeSec: number;
  label: string;
  short: string;
  /** Reference to the MediaAsset this snapshot was analysed against (playback identity). */
  mediaId?: string;
  column: SnapshotMeasurement[];
  drawingsJson: string;
  overlaysOn: boolean;
  overlayAdjustments: Record<string, OverlayAdjustment>;
  screenshot?: string;
  notes?: string;
  /** Pose keypoints captured at this frame. */
  skeleton?: SnapshotKeypoint[];
  /** Raw AI-detected values (angles, distances) keyed by metric. */
  aiDetection?: Record<string, number>;
  /** Derived joint angles keyed by joint label. */
  jointAngles?: Record<string, number>;
}

let snapshotCounter = 0;

export function makeSnapshot(timeSec: number, label: string, short: string): Snapshot {
  snapshotCounter += 1;
  return {
    id: `snap-${Date.now()}-${snapshotCounter}`,
    timeSec,
    label,
    short,
    column: [],
    drawingsJson: '',
    overlaysOn: false,
    overlayAdjustments: {},
  };
}

/** Snapshots sorted by timeline position (for replay + timeline rendering). */
export function sortSnapshots(snaps: Snapshot[]): Snapshot[] {
  return [...snaps].sort((a, b) => a.timeSec - b.timeSec);
}

/** Derive the phase-marker shape consumed by PreciseTimeline. */
export function toPhaseMarkers(
  snaps: Snapshot[],
): Array<{ id: string; label: string; short?: string; time: number }> {
  return sortSnapshots(snaps).map((s) => ({ id: s.id, label: s.label, short: s.short, time: s.timeSec }));
}
