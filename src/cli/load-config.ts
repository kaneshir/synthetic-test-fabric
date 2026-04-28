import * as fs from 'fs';
import * as path from 'path';
import type { FabricConfig } from './types';

const CONFIG_NAMES = [
  'fabric.config.ts',
  'fabric.config.js',
  'fabric.config.mjs',
  'fabric.config.cjs',
];

export async function loadFabricConfig(configPath?: string): Promise<FabricConfig> {
  const resolved = configPath
    ? path.resolve(configPath)
    : findConfig();

  if (!resolved || !fs.existsSync(resolved)) {
    throw new Error(
      [
        'fab: No config file found. Create fabric.config.ts in your project root.',
        `  Searched: ${CONFIG_NAMES.join(', ')}`,
        '  Or pass --config <path> to specify a location.',
      ].join('\n')
    );
  }

  if (resolved.endsWith('.ts')) {
    // Register tsx as a CJS require hook so `require(resolved)` understands TypeScript.
    // tsx must be installed in the consumer project (npm install -D tsx).
    try {
      require('tsx/cjs');
    } catch {
      throw new Error(
        [
          'fab: TypeScript config requires tsx to be installed.',
          '  npm install -D tsx',
          '  Or compile your config to JS first.',
        ].join('\n')
      );
    }
  }

  // Dynamic import handles ESM (.mjs) and CJS (.js/.cjs) natively.
  // For .ts files, the tsx/cjs hook registered above handles the require() path.
  const mod = resolved.endsWith('.ts')
    ? require(resolved)
    : await import(resolved);

  const config: FabricConfig = mod.default ?? mod;

  if (!config?.adapters) {
    throw new Error(
      'fab: Config must export a default object with an `adapters` key.\n' +
      '  See docs/quickstart.md for an example fabric.config.ts.'
    );
  }

  return config;
}

function findConfig(): string | null {
  const cwd = process.cwd();
  for (const name of CONFIG_NAMES) {
    const p = path.join(cwd, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
