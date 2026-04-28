import { defineConfig } from '@playwright/test';
import * as path from 'path';

const appDir = process.env.DEMO_APP_DIR ?? path.join(__dirname, 'app');

export default defineConfig({
  testDir: './flows',
  timeout: 30_000,
  use: {
    baseURL: `file://${appDir}/`,
    headless: true,
  },
  reporter: [['json', { outputFile: process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ?? 'flow-results.json' }]],
});
