import { isYmd, shiftDay } from '@/lib/players/nutrition';

/** The days a workouts request covers: default 4 weeks back to 4 weeks ahead; at most 120 days. */
export function workoutRange(from: unknown, to: unknown, today: string): { from: string; to: string } {
  let f = isYmd(from) ? from : shiftDay(today, -28);
  let t = isYmd(to) ? to : shiftDay(today, 28);
  if (f > t) [f, t] = [t, f];
  if (shiftDay(f, 120) < t) t = shiftDay(f, 120);
  return { from: f, to: t };
}
