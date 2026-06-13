#!/usr/bin/env tsx
/**
 * check-release.ts — release hygiene guard.
 *
 *  1. No tracked `node_modules` — a committed dir/symlink bakes a local absolute
 *     path (or vendored deps) into the repo. Dev worktrees often symlink it;
 *     `.gitignore`'s `node_modules/` matches directories but NOT a symlink, so
 *     `git add -A` can stage it. This fails the build before that ships.
 *  2. package.json version matches package-lock.json (root + packages[""]), so a
 *     release bump can't leave the lockfile inconsistent.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const failures: string[] = [];

// 1. tracked node_modules
try {
  const tracked = execFileSync('git', ['ls-files', 'node_modules'], { encoding: 'utf8' }).trim();
  if (tracked) failures.push(`tracked node_modules entries (must never be committed):\n    ${tracked.split('\n').join('\n    ')}`);
} catch {
  // not a git checkout (e.g. inside a published tarball) — skip this check
}

// 2. version consistency
const pkg = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.resolve('package-lock.json'), 'utf8'));
const v = pkg.version as string;
if (lock.version !== v) failures.push(`package-lock.json root version ${lock.version} != package.json ${v}`);
if (lock.packages?.['']?.version !== v) failures.push(`package-lock.json packages[""] version ${lock.packages?.['']?.version} != package.json ${v}`);

if (failures.length) {
  console.error('Release hygiene check FAILED:');
  for (const f of failures) console.error('  - ' + f);
  process.exit(1);
}
console.log(`Release hygiene check passed (version ${v}, no tracked node_modules).`);
