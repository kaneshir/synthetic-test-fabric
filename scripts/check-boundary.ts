#!/usr/bin/env npx tsx
/**
 * Verifies that test-fabric-core contains no imports from app-specific packages.
 * Run: npx tsx scripts/check-boundary.ts
 * Exit 0 = clean, Exit 1 = violations found
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Forbidden patterns — any import matching one of these is a violation.
// ---------------------------------------------------------------------------
const FORBIDDEN_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /backend-api/, reason: 'NestJS backend (app-specific)' },
  { pattern: /flutter-e2e/, reason: 'Flutter E2E package (app-specific)' },
  { pattern: /[/\\]flutter[/\\]/, reason: 'Flutter app directory (app-specific)' },
  { pattern: /[/\\]nuxt[/\\]/, reason: 'Nuxt web app directory (app-specific)' },
  { pattern: /^@blueskil\//, reason: '@blueskil/ scoped package (app-specific)' },
  { pattern: /^firebase-admin/, reason: 'firebase-admin (app-specific server SDK)' },
  { pattern: /^@nestjs\//, reason: '@nestjs/ scoped package (app-specific framework)' },
  { pattern: /^@google-cloud\//, reason: '@google-cloud/ scoped package (app-specific cloud SDK)' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Recursively collect production .ts files under a directory.
 * Excludes test files (*.test.ts, *.spec.ts) — test fixtures may contain
 * forbidden import strings as string literals without being real violations.
 */
function collectTsFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectTsFiles(full));
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.test.ts') &&
      !entry.name.endsWith('.spec.ts')
    ) {
      results.push(full);
    }
  }
  return results;
}

interface Violation {
  file: string;
  line: number;
  importPath: string;
  reason: string;
}

/**
 * Extract all import/require strings from source text with their line numbers.
 *
 * Covers all four TypeScript/JS import forms:
 *   1. import('pkg')              — dynamic import
 *   2. import 'pkg'               — side-effect import (no `from`)
 *   3. from 'pkg'                 — named/default/namespace import or re-export
 *   4. require('pkg')             — CommonJS require
 */
export function extractImports(source: string): Array<{ line: number; importPath: string }> {
  // Group 1: dynamic import(...)
  // Group 2: side-effect  import 'pkg' / import type 'pkg'
  // Group 3: from clause  from 'pkg'
  // Group 4: require      require('pkg')
  const IMPORT_RE =
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|\bimport\s+(?:type\s+)?['"]([^'"]+)['"]|\bfrom\s+['"]([^'"]+)['"]|\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

  const results: Array<{ line: number; importPath: string }> = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    let match: RegExpExecArray | null;
    IMPORT_RE.lastIndex = 0; // reset for each line
    while ((match = IMPORT_RE.exec(lineText)) !== null) {
      const importPath = match[1] ?? match[2] ?? match[3] ?? match[4];
      if (importPath) {
        results.push({ line: i + 1, importPath });
      }
    }
  }

  return results;
}

function checkFile(filePath: string): Violation[] {
  const source = fs.readFileSync(filePath, 'utf8');
  const imports = extractImports(source);
  const violations: Violation[] = [];

  for (const { line, importPath } of imports) {
    for (const { pattern, reason } of FORBIDDEN_PATTERNS) {
      if (pattern.test(importPath)) {
        violations.push({ file: filePath, line, importPath, reason });
        break; // one match per import is enough
      }
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Main — only runs when executed directly, not when imported by tests
// ---------------------------------------------------------------------------

if (require.main === module) {
  const srcDir = path.join(__dirname, '..', 'src');

  if (!fs.existsSync(srcDir)) {
    console.error(`ERROR: src directory not found at ${srcDir}`);
    process.exit(1);
  }

  const files = collectTsFiles(srcDir);
  const allViolations: Violation[] = [];

  for (const file of files) {
    allViolations.push(...checkFile(file));
  }

  if (allViolations.length === 0) {
    console.log(`Boundary check passed. Scanned ${files.length} file(s) — no violations found.`);
    process.exit(0);
  } else {
    console.error(`\nBoundary violations found in test-fabric-core (${allViolations.length} total):\n`);
    for (const v of allViolations) {
      const rel = path.relative(path.join(__dirname, '..'), v.file);
      console.error(`  ${rel}:${v.line}  import '${v.importPath}'`);
      console.error(`    Reason: ${v.reason}\n`);
    }
    console.error(
      'Fix: remove or replace the forbidden imports above.\n' +
        'See packages/test-fabric-core/BOUNDARY.md for the full allowed-import list.',
    );
    process.exit(1);
  }
}
