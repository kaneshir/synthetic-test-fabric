/**
 * demo/mcp-target.ts — MCP target testing demo for synthetic-test-fabric (#48).
 *
 * Spins up the bundled compliant MCP fixture server, then drives it as a target:
 * discovers the catalog, measures coverage, runs the generic protocol probe
 * battery, and prints the `details.mcp`-shaped assessment. No real backend, no
 * secrets — point `assessMcpTarget` at any MCP endpoint to test your own.
 *
 * Usage:
 *   npm run build && npx tsx demo/mcp-target.ts
 */
import {
  startFixture,
  assessMcpTarget,
  runProtocolProbes,
  runMcpCoverage,
  McpExecutor,
} from '../dist/index.js';

async function main(): Promise<void> {
  const fixture = await startFixture();
  console.log(`▶ MCP fixture listening at ${fixture.url}\n`);

  const config = {
    endpoint: fixture.url,
    dbPath: '', // demo: not recording behavior events
    simulationId: 'demo',
    agentId: 'demo-agent',
    token: 'valid-aal2',
  };

  try {
    // 1. Discover the advertised catalog.
    const exec = new McpExecutor(config);
    const tools = await exec.listTools();
    console.log(`Discovered ${tools.length} tools: ${tools.map((t) => t.name).join(', ')}\n`);

    // 2. Coverage — invoke each tool with a schema-generated valid input (read-only by default).
    const coverage = await runMcpCoverage(exec, { log: (m) => console.log(`  · ${m}`) });
    console.log(
      `Coverage: ${coverage.covered.length}/${coverage.toolsTotal - coverage.skippedByPolicy.length} in-policy ` +
        `(ratio ${(coverage.coverageRatio * 100).toFixed(0)}%), ${coverage.skippedByPolicy.length} write(s) skipped\n`,
    );

    // 3. Generic protocol probe battery.
    const probes = await runProtocolProbes(config);
    console.log(`Adversarial: ${probes.secure} secure, ${probes.violations} violations, ${probes.inconclusive} inconclusive`);
    for (const r of probes.results) console.log(`  ${r.verdict === 'secure' ? '✓' : '✗'} ${r.name} (${r.verdict})`);
    console.log('');

    // 4. Combined assessment — the FabricScore.details.mcp shape.
    const score = await assessMcpTarget(config, { surface: 'read-only-surface' });
    console.log('details.mcp =', JSON.stringify(score, null, 2));
    console.log(`\n${score.passed ? '✅ PASS' : '❌ FAIL'} — protocol ${score.protocolVersion}`);
  } finally {
    await fixture.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
