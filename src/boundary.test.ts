/**
 * Boundary checker tests.
 *
 * Two layers:
 *   1. Unit tests for extractImports() — verify each import syntax form is caught.
 *   2. Integration test — run the full script against the real src/ tree.
 */
import { execSync } from 'child_process';
import * as path from 'path';
import { extractImports } from '../scripts/check-boundary';

// ---------------------------------------------------------------------------
// Unit tests: extractImports must recognise all four import forms
// ---------------------------------------------------------------------------

describe('extractImports', () => {
  it('captures named import (from clause)', () => {
    const src = `import { foo } from '@blueskil/shared';`;
    const found = extractImports(src).map((x) => x.importPath);
    expect(found).toContain('@blueskil/shared');
  });

  it('captures default import (from clause)', () => {
    const src = `import Foo from '@nestjs/common';`;
    const found = extractImports(src).map((x) => x.importPath);
    expect(found).toContain('@nestjs/common');
  });

  it('captures re-export (from clause)', () => {
    const src = `export { Bar } from 'firebase-admin';`;
    const found = extractImports(src).map((x) => x.importPath);
    expect(found).toContain('firebase-admin');
  });

  it('captures side-effect import (no from clause)', () => {
    const src = `import '@blueskil/shared';`;
    const found = extractImports(src).map((x) => x.importPath);
    expect(found).toContain('@blueskil/shared');
  });

  it('captures dynamic import', () => {
    const src = `const m = await import('@blueskil/shared');`;
    const found = extractImports(src).map((x) => x.importPath);
    expect(found).toContain('@blueskil/shared');
  });

  it('captures require()', () => {
    const src = `const x = require('@nestjs/common');`;
    const found = extractImports(src).map((x) => x.importPath);
    expect(found).toContain('@nestjs/common');
  });

  it('does not capture relative imports as forbidden', () => {
    const src = `import { foo } from './schema';`;
    const found = extractImports(src).map((x) => x.importPath);
    expect(found).toContain('./schema');
    // relative — not forbidden, just present
  });

  it('captures import type (side-effect form with type keyword)', () => {
    const src = `import type '@blueskil/shared';`;
    const found = extractImports(src).map((x) => x.importPath);
    expect(found).toContain('@blueskil/shared');
  });

  it('returns correct line numbers', () => {
    const src = `import 'node:fs';\nimport '@blueskil/shared';\n`;
    const hits = extractImports(src);
    const forbidden = hits.find((x) => x.importPath === '@blueskil/shared');
    expect(forbidden?.line).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Integration test: real src/ tree must be clean
// ---------------------------------------------------------------------------

describe('extraction boundary (real src tree)', () => {
  it('test-fabric-core src/ has no imports from app-specific packages', () => {
    const scriptPath = path.join(__dirname, '../scripts/check-boundary.ts');
    let output = '';
    let exitCode = 0;
    try {
      output = execSync(`npx tsx "${scriptPath}"`, {
        cwd: path.join(__dirname, '..'),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: any) {
      output = (err.stdout ?? '') + (err.stderr ?? '');
      exitCode = err.status ?? 1;
    }
    if (exitCode !== 0) {
      throw new Error(`Boundary violations found:\n${output}`);
    }
  });
});
