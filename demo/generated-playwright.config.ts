import { defineConfig } from '@playwright/test';
import * as path from 'path';

const testDir = process.env.GENERATED_FLOWS_DIR ?? path.join(__dirname, 'generated-flows');
const appDir = process.env.DEMO_APP_DIR ?? path.join(__dirname, 'app');

export default defineConfig({
  testDir,
  timeout: 30_000,
  use: {
    baseURL: `file://${appDir}/`,
    headless: true,
  },
  reporter: [['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? 'generated-flow-results.json' }]],
});
