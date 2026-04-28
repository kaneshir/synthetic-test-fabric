/**
 * Subprocess wiring pattern from docs/wiring-non-js-backends.md — Pattern B.
 * Verifies env var injection and SimulationRunResult shape.
 */
import { execFileSync } from 'child_process';
import * as path from 'path';
import type { SimulationAdapter, SimulationRunResult, SeededEntity } from 'synthetic-test-fabric';

export class SubprocessSimulationAdapter implements SimulationAdapter {
  async run(iterRoot: string, options: {
    ticks: number; liveLlm: boolean; simulationId?: string;
  }): Promise<SimulationRunResult> {
    const lisaMemoryDir = path.join(iterRoot, '.lisa_memory');

    let stdout: Buffer;
    try {
      stdout = execFileSync('./bin/sim', [
        '--iter-root', iterRoot,
        '--ticks',     String(options.ticks),
        '--simulation-id', options.simulationId ?? '',
      ], {
        timeout: 120_000,
        env: {
          ...process.env,
          LISA_DB_ROOT:    iterRoot,
          LISA_MEMORY_DIR: lisaMemoryDir,
        },
      });
    } catch (err: unknown) {
      const e = err as { status?: number; stderr?: Buffer };
      const stderr = e.stderr?.toString() ?? '';
      throw new Error(`[sim] process exited with code ${e.status}: ${stderr}`);
    }

    try {
      return JSON.parse(stdout.toString()) as SimulationRunResult;
    } catch {
      throw new Error(`[sim] invalid JSON from subprocess: ${stdout.toString().slice(0, 200)}`);
    }
  }

  async exportEntities(iterRoot: string, entities: SeededEntity[]): Promise<void> {}

  async clean(iterRoot: string): Promise<void> {}
}
