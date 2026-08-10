export type Point2D = { x: number; y: number };

export type RulerMode = 'calibrate' | 'measure';

export type CalibrationMethod = 'simple' | 'homography';

export interface RulerCalibration {
  method: CalibrationMethod;
  presetId: string;
  /** Pixel coords of calibration points (in display space) */
  srcPoints: Point2D[];
  /** Real-world coords of calibration points (meters) */
  dstPoints: Point2D[];
  /** Pixels per meter (simple mode) */
  scale?: number;
  /** 9-element row-major homography matrix (homography mode) */
  homography?: number[];
  /**
   * The reference length the coach actually entered, in METERS, for simple
   * 2-point calibrations. Kept so the "Calibrated" readout can say what it was
   * calibrated FROM ("27 in racket") instead of only showing a scale number.
   */
  referenceMeters?: number;
  /**
   * Which clip this calibration belongs to (the page's `videoSrc`). Camera
   * distance changes the pixels-per-meter scale, so a calibration is only
   * valid for the video it was measured on — see the scope note in
   * RulerOverlay. Never reuse a scale across clips silently.
   */
  videoKey?: string | null;
}

export interface RulerMeasurement {
  id: string;
  p1: Point2D;
  p2: Point2D;
  /** Distance in meters */
  distanceM: number;
}
