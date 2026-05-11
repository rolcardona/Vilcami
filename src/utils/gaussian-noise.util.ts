/**
 * Generates a normally-distributed random value using the Box-Muller transform.
 *
 * Returns values from a standard normal distribution with mean ~ 0 and
 * standard deviation ~ 1. Uses Math.random() as the entropy source.
 *
 * Used in VILCAMI's IoT sensor ingestion pipeline to simulate realistic
 * telemetry noise for testing and calibration of industrial threshold rules
 * (e.g., Y2 differential checks, staggered start hysteresis).
 */
export function generateGaussianNoise(): number {
  let uniformRandomValueOne = 0;
  let uniformRandomValueTwo = 0;

  // Box-Muller requires u1 > 0, so loop until we get a non-zero value.
  // Math.random() returns [0, 1) — zero is possible but rare.
  while (uniformRandomValueOne === 0) {
    uniformRandomValueOne = Math.random();
  }
  uniformRandomValueTwo = Math.random();

  // Box-Muller polar form: Z = sqrt(-2 * ln(u1)) * cos(2 * pi * u2)
  return (
    Math.sqrt(-2.0 * Math.log(uniformRandomValueOne)) *
    Math.cos(2.0 * Math.PI * uniformRandomValueTwo)
  );
}
