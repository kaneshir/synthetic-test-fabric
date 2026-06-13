import { startFixture, FixtureHandle } from './fixture-server';
import { assessMcpTarget, mcpScoreToDetails } from './score';

describe('assessMcpTarget (#47)', () => {
  let fx: FixtureHandle;
  beforeEach(async () => {
    fx = await startFixture();
  });
  afterEach(async () => {
    await fx.close();
  });

  const cfg = () => ({ endpoint: fx.url, dbPath: '', simulationId: 's', agentId: 'a', token: 'valid-aal2' });

  it('combines coverage + probes into a details.mcp-shaped score', async () => {
    const score = await assessMcpTarget(cfg(), { surface: 'read-only-surface' });

    expect(score.surface).toBe('read-only-surface');
    expect(score.protocolVersion).toBe('2025-03-26');
    // coverage: read.item + read.restricted covered, broken uncovered, write skipped
    expect(score.coverage.toolsTotal).toBe(4);
    expect(score.coverage.covered).toBe(2);
    expect(score.coverage.skippedByPolicy).toBe(1);
    expect(score.coverage.ratio).toBeCloseTo(2 / 3, 5);
    // adversarial: all 8 generic probes hold
    expect(score.adversarial.violations).toBe(0);
    expect(score.adversarial.inconclusive).toBe(0);
    expect(score.adversarial.passed).toBe(true);
    // overall passes (no coverage threshold)
    expect(score.passed).toBe(true);
  });

  it('fails overall when the coverage threshold is not met (even if probes pass)', async () => {
    const score = await assessMcpTarget(cfg(), { coverageThreshold: 0.8 });
    expect(score.adversarial.passed).toBe(true);
    expect(score.coverage.ratio).toBeLessThan(0.8);
    expect(score.passed).toBe(false);
  });

  it('mcpScoreToDetails wraps the score under the mcp key for FabricScore.details', async () => {
    const score = await assessMcpTarget(cfg());
    const details = mcpScoreToDetails(score);
    expect(details.mcp).toBe(score);
    // merges cleanly into a FabricScore.details bag
    const merged: Record<string, unknown> = { existing: 1, ...details };
    expect(merged).toHaveProperty('existing', 1);
    expect(merged).toHaveProperty('mcp');
  });
});
