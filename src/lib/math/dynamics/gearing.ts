/**
 * Gearing.
 *
 * The one thing `/methodology/` names as the model's largest blind spot: the
 * top-speed solve finds where power balances drag and knows nothing about
 * whether the car has a gear tall enough to get there. For the Toyota 86 that
 * gap is 25 km/h — the car runs out of gears before it runs out of power, and
 * the model reported the speed it *would* reach with an eighth gear.
 *
 * This closes that gap for anyone who supplies gearing, and changes nothing at
 * all for anyone who does not. Gearing is optional on `VehicleInputs`; absent,
 * every figure is exactly what it was before. Build Car is where
 * it earns its keep, because a visitor specifying a hypothetical car can state
 * its gearing where the content collections almost never publish it.
 *
 * **Why km/h per 1000 rpm rather than gear ratios.** A ratio alone cannot give
 * a road speed — it needs the final drive and the rolling circumference of the
 * tyre as well, so three fields where one will do, and two of the three are
 * published even less often than the first. Road speed per 1000 rpm in top is a
 * single number, is quoted directly in road tests, and can be read off any car
 * with a tachometer. It is the same physics with the arithmetic already done.
 */

export interface Gearing {
  /** Road speed in km/h at 1000 rpm in the highest gear. */
  kmhPer1000rpm: number;
  /**
   * Engine speed at which the run ends — the rev limiter, or the point past
   * peak power where there is nothing left to gain.
   */
  redlineRpm: number;
}

/**
 * The fastest the car can physically be geared to go, km/h.
 *
 * `v = (km/h per 1000 rpm) × rpm / 1000`. Nothing subtle: it is the definition
 * of the input, restated. Returns `null` on a non-positive input rather than a
 * zero, because "no gearing supplied" and "geared to do nothing" are different
 * statements and only one of them is honest to display.
 */
export function gearedTopSpeed(gearing: Gearing | undefined): number | null {
  if (!gearing) return null;
  const { kmhPer1000rpm, redlineRpm } = gearing;
  if (!(kmhPer1000rpm > 0) || !(redlineRpm > 0)) return null;
  return (kmhPer1000rpm * redlineRpm) / 1000;
}

/**
 * Engine speed at a given road speed in the highest gear, rpm.
 *
 * The other direction, and the reason a tall final drive is a real design
 * choice rather than a free win: it is what makes a motorway cruise quiet, and
 * it is also what leaves the car unable to reach its own aerodynamic ceiling.
 */
export function rpmAtSpeed(gearing: Gearing | undefined, speedKmh: number): number | null {
  if (!gearing || !(gearing.kmhPer1000rpm > 0) || speedKmh < 0) return null;
  return (speedKmh / gearing.kmhPer1000rpm) * 1000;
}
