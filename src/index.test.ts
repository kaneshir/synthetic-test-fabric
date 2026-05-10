// Public API surface regression. Scans src/index.ts to verify that every
// symbol the package CLAIMS to export is actually re-exported.
//
// Caught by reviewer on #20: inspectRunRoot was implemented but missing from
// src/index.ts, so consumers couldn't import it from the package. The
// `check:package-surface` script doesn't catch this — it only validates that
// no forbidden symbols slip in, not that promised symbols are present.
//
// Source-text scan instead of runtime require() because pixelmatch (a
// transitive dep) is pure ESM and breaks `require('./dist')` under jest's
// CommonJS environment. The text scan still directly catches the regression
// class — forgetting to add an export — at near-zero cost.

import * as fs from 'fs';
import * as path from 'path';

const INDEX_SRC = fs.readFileSync(
  path.resolve(__dirname, 'index.ts'),
  'utf8',
);

/** Asserts that `symbol` appears in src/index.ts as a re-exported name. */
function expectExported(symbol: string): void {
  // Permissive regex: matches `export { foo`, `, foo,`, `foo,`, `foo }`, etc.
  // Anchors on word boundary so `inspectRunRoot` doesn't match `inspectRunRootHelper`.
  const re = new RegExp(`\\b${symbol}\\b`);
  if (!re.test(INDEX_SRC)) {
    throw new Error(
      `src/index.ts is missing required export: ${symbol}\n` +
      `Add it to the appropriate \`export { … } from './...';\` block.`,
    );
  }
}

describe('public API surface (src/index.ts)', () => {
  describe('run-root helpers (#18 + #20)', () => {
    it.each([
      // Pre-existing exports — guard against accidental removal.
      'resolveLoopPaths',
      'makeLoopId',
      'FABRIC_SEAL_FILE',
      'assertCanWriteRunRoot',
      'sealRunRoot',
      'requireSimulationId',
      'requireArtifactSimulationId',
      'LoopIterationPaths',
      // Added in #18 — were never re-exported until #20 caught it.
      'detectRootKind',
      'resolveLoopRoot',
      'resolveIterRoot',
      'AmbiguousRootError',
      'UnknownRootError',
      'RootKind',
      // Added in #20.
      'inspectRunRoot',
      'RunRootSummary',
      'RunPhase',
      'BehaviorEventSummary',
    ])('exports %s', (name) => {
      expectExported(name);
    });
  });

  describe('project scaffolder (#21)', () => {
    it.each([
      'scaffoldProject',
      'InitConflictError',
      'InitOptions',
      'InitResult',
    ])('exports %s', (name) => {
      expectExported(name);
    });
  });

  describe('per-adapter scaffolder (#22)', () => {
    it.each([
      'scaffoldAdapter',
      'ScaffoldAdapterError',
      'ScaffoldAdapterOptions',
      'ScaffoldAdapterResult',
      'renderAdapterStub',
      'isAdapterType',
      'AdapterType',
      'ADAPTER_TYPES',
      'ADAPTER_INTERFACES',
      'DEFAULT_ADAPTER_CLASS_NAMES',
    ])('exports %s', (name) => {
      expectExported(name);
    });
  });

  describe('adapter validator (#23)', () => {
    it.each([
      'validateAdapter',
      'AdapterValidateError',
      'ValidationError',
      'ValidationResult',
      'ValidateAdapterOptions',
    ])('exports %s', (name) => {
      expectExported(name);
    });
  });

  describe('doctor (#24)', () => {
    it.each([
      'runDoctor',
      'DoctorCheck',
      'DoctorResult',
      'RunDoctorOptions',
      'CheckStatus',
    ])('exports %s', (name) => {
      expectExported(name);
    });
  });

  describe('mcp server (#27)', () => {
    it.each([
      'runFabCommand',
      'FAB_CLI_PATH',
      'resolveEnvTimeoutMs',
      'RunFabResult',
      'RunFabOptions',
      'createMcpServer',
      'TOOL_COUNT',
      'TOOL_NAMES',
    ])('exports %s', (name) => {
      expectExported(name);
    });
  });
});
