import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadSyntheticConfig } from './config';

describe('loadSyntheticConfig', () => {
  it('throws a clear message when no config file exists', () => {
    // Use os.tmpdir() root — guaranteed to have no synthetic.config.js above it
    const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-config-test-'));
    try {
      expect(() => loadSyntheticConfig(isolated)).toThrow(
        'synthetic.config.js not found — create one at your project root.',
      );
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });

  it('returns the default export when a valid config file is present', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-config-test-'));
    try {
      const configPath = path.join(tmpDir, 'synthetic.config.js');
      const stubConfig = {
        projectRoot: tmpDir,
        playwrightCwd: path.join(tmpDir, 'packages', 'flutter-e2e'),
        cliBinPath: path.join(tmpDir, 'packages', 'blu-cli', 'bin', 'run.cjs'),
        knownFlowsPath: path.join(tmpDir, 'flutter', '.lisa_memory', 'flows.yaml'),
        scorecardScriptPath: path.join(tmpDir, 'scripts', 'testing-scorecard.js'),
      };

      fs.writeFileSync(
        configPath,
        `'use strict';\nmodule.exports = { default: ${JSON.stringify(stubConfig)} };\n`,
        'utf8',
      );

      // Clear require cache so our freshly written file is loaded
      delete require.cache[require.resolve(configPath)];

      const result = loadSyntheticConfig(tmpDir);
      expect(result.projectRoot).toBe(tmpDir);
      expect(result.playwrightCwd).toBe(path.join(tmpDir, 'packages', 'flutter-e2e'));
      expect(result.cliBinPath).toBe(path.join(tmpDir, 'packages', 'blu-cli', 'bin', 'run.cjs'));
      expect(result.knownFlowsPath).toBe(path.join(tmpDir, 'flutter', '.lisa_memory', 'flows.yaml'));
      expect(result.scorecardScriptPath).toBe(path.join(tmpDir, 'scripts', 'testing-scorecard.js'));
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('throws when config exists but is missing required fields', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-config-test-'));
    try {
      const configPath = path.join(tmpDir, 'synthetic.config.js');
      // projectRoot only — missing playwrightCwd, cliBinPath, knownFlowsPath
      fs.writeFileSync(
        configPath,
        `'use strict';\nmodule.exports = { default: { projectRoot: '${tmpDir}' } };\n`,
        'utf8',
      );
      delete require.cache[require.resolve(configPath)];
      expect(() => loadSyntheticConfig(tmpDir)).toThrow('missing required fields');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds the config in a parent directory when searching from a subdirectory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'synthetic-config-test-'));
    const subDir = path.join(tmpDir, 'packages', 'some-package');
    try {
      fs.mkdirSync(subDir, { recursive: true });
      const configPath = path.join(tmpDir, 'synthetic.config.js');
      const stubConfig = {
        projectRoot: tmpDir,
        playwrightCwd: path.join(tmpDir, 'packages', 'flutter-e2e'),
        cliBinPath: path.join(tmpDir, 'packages', 'blu-cli', 'bin', 'run.cjs'),
        knownFlowsPath: path.join(tmpDir, 'flutter', '.lisa_memory', 'flows.yaml'),
      };

      fs.writeFileSync(
        configPath,
        `'use strict';\nmodule.exports = { default: ${JSON.stringify(stubConfig)} };\n`,
        'utf8',
      );

      delete require.cache[require.resolve(configPath)];

      const result = loadSyntheticConfig(subDir);
      expect(result.projectRoot).toBe(tmpDir);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
