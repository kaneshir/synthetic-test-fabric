/**
 * HTTP/REST wiring pattern from docs/wiring-non-js-backends.md — Pattern A.
 * Verifies the SimulationAdapter interface and SimulationRunResult shape.
 */
import type { SimulationAdapter, SimulationRunResult, SeededEntity } from 'synthetic-test-fabric';

export class HttpSimulationAdapter implements SimulationAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl = process.env['SIM_SERVICE_URL'] ?? 'http://localhost:8080') {
    this.baseUrl = baseUrl;
  }

  async run(iterRoot: string, options: {
    ticks: number; liveLlm: boolean; simulationId?: string;
  }): Promise<SimulationRunResult> {
    const res = await fetch(`${this.baseUrl}/simulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        iter_root: iterRoot,
        ticks: options.ticks,
        live_llm: options.liveLlm,
        simulation_id: options.simulationId,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '(no body)');
      throw new Error(`[sim] HTTP ${res.status}: ${body}`);
    }

    return res.json() as Promise<SimulationRunResult>;
  }

  async exportEntities(iterRoot: string, entities: SeededEntity[]): Promise<void> {}

  async clean(iterRoot: string): Promise<void> {}
}
