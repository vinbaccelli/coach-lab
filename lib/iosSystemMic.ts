/**
 * iPhone/iPad: the system "Screen Recording" owns the microphone. When the page opens its own mic
 * (getUserMedia with audio) iOS hands the mic to the page and the system recording goes silent and
 * then fails to save ("asset writer failing to save"). So on iOS the page must never ask for audio;
 * the coach's voice comes from the system recorder.
 */
export function isIosDevice(ua: string, platform: string, touchPoints: number): boolean {
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS reports a desktop Mac.
  return platform === 'MacIntel' && touchPoints > 1;
}

/** Constraints for the camera: video only on iOS, video + recording audio elsewhere. */
export function cameraConstraints(ios: boolean, audio: MediaTrackConstraints): MediaStreamConstraints {
  return ios ? { video: true } : { video: true, audio };
}

export function iosDeviceNow(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isIosDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints ?? 0);
}
