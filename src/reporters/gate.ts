import type { FabricScore } from '../score';

/**
 * Throws if the fabric score is below the threshold.
 * Use in CI to block merges when quality regresses.
 *
 *   const score = JSON.parse(fs.readFileSync('fabric-score.json', 'utf8'));
 *   assertScoreThreshold(score, 8.0); // throws if score.overall < 8.0
 *
 * Or via the CLI:
 *   npx fab check --root <run-root> --threshold 8.0
 */
export function assertScoreThreshold(score: FabricScore, threshold: number): void {
  if (score.overall < threshold) {
    const msg = [
      `Fabric score ${score.overall.toFixed(1)} is below threshold ${threshold.toFixed(1)}.`,
      '',
      'Dimension breakdown:',
      ...Object.entries(score.dimensions).map(
        ([k, v]) => `  ${k.padEnd(20)} ${(v as number).toFixed(1)}`
      ),
    ];

    if (score.flakiness?.quarantinedFlows.length) {
      msg.push('', `Quarantined flows: ${score.flakiness.quarantinedFlows.join(', ')}`);
    }

    throw new Error(msg.join('\n'));
  }
}
