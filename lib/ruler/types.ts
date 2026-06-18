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
}

export interface RulerMeasurement {
  id: string;
  p1: Point2D;
  p2: Point2D;
  /** Distance in meters */
  distanceM: number;
}
