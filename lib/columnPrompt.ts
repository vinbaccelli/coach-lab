/**
 * Data-column prompt workflow.
 *
 * Before: every measurement a drawing produced (angle, arrow angle, distance, ruler) opened a "Name this
 * measurement" modal at once while the column box was visible, so a coach drawing ten marks was asked ten times.
 * Now the last measurement is only REMEMBERED; the column's "+" is where the coach asks to add it. One pending slot:
 * a newer drawing replaces the older one ("that last drawing").
 */

export interface LastMeasurement { type: string; value: number; unit: string }

/** The default name offered in the naming prompt for each measurement type (unchanged from the old modal). */
export function defaultMeasurementName(type: string): string {
  return type === 'angle' ? 'Angle' : type === 'arrowAngle' ? 'Arrow angle' : 'Distance';
}

/** What the column "+" should do: ask about the last drawing when there is one, else the manual note it always opened. */
export function plusAction(last: LastMeasurement | null): 'ask-last-drawing' | 'manual-note' {
  return last ? 'ask-last-drawing' : 'manual-note';
}
