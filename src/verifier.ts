/**
 * verifier.ts
 *
 * Generic fail-closed pre-run verification contract for the test fabric.
 *
 * Adapter implementations satisfy VerifierContract so the CLI can drive
 * verification without knowing anything about the underlying assertions.
 */

export interface VerificationResult {
  pass: boolean;
  errors: string[];
  warnings: string[];
}

export interface VerifierContract {
  /**
   * Run all pre-flight checks against the given iteration root directory.
   *
   * @param iterRoot - Absolute path to the run root that contains lisa.db and
   *                   any other artefacts written by a preceding simulation run.
   * @returns A VerificationResult.  Implementations must NEVER throw — errors
   *          must be captured into `errors` and `pass` set to `false`.
   */
  verify(iterRoot: string): Promise<VerificationResult>;
}
