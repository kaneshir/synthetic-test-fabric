import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  detectRootKind,
  resolveLoopRoot,
  resolveIterRoot,
  resolveLoopPaths,
} from './run-root';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fab-rr-'));
}

function rm(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('detectRootKind', () => {
  it('throws on non-existent path', () => {
    expect(() => detectRootKind('/tmp/definitely-does-not-exist-' + Date.now())).toThrow(/does not exist/);
  });

  it('returns "loop" on an empty directory (loop intent)', () => {
    const d = tmp();
    try { expect(detectRootKind(d)).toBe('loop'); } finally { rm(d); }
  });

  it('returns "loop" when iter-NNN subdirs exist', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'iter-001'));
      fs.mkdirSync(path.join(d, 'iter-002'));
      expect(detectRootKind(d)).toBe('loop');
    } finally { rm(d); }
  });

  it('returns "loop" when only a current symlink exists', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'iter-001'));
      fs.symlinkSync('iter-001', path.join(d, 'current'));
      expect(detectRootKind(d)).toBe('loop');
    } finally { rm(d); }
  });

  it('returns "iteration" when fabric-score.json is at root', () => {
    const d = tmp();
    try {
      fs.writeFileSync(path.join(d, 'fabric-score.json'), '{}');
      expect(detectRootKind(d)).toBe('iteration');
    } finally { rm(d); }
  });

  it('returns "ambiguous" when both shapes present', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'iter-001'));
      fs.writeFileSync(path.join(d, 'fabric-score.json'), '{}');
      expect(detectRootKind(d)).toBe('ambiguous');
    } finally { rm(d); }
  });

  it('returns "unknown" for a non-empty dir that matches nothing', () => {
    const d = tmp();
    try {
      fs.writeFileSync(path.join(d, 'random.txt'), 'x');
      fs.mkdirSync(path.join(d, 'subdir'));
      expect(detectRootKind(d)).toBe('unknown');
    } finally { rm(d); }
  });
});

describe('resolveLoopRoot', () => {
  it('returns loopRoot unchanged when given a loopRoot', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'iter-001'));
      expect(resolveLoopRoot(d)).toBe(d);
    } finally { rm(d); }
  });

  it('returns parent when given an iterRoot', () => {
    const d = tmp();
    try {
      const iter = path.join(d, 'iter-001');
      fs.mkdirSync(iter);
      // To make iter look like an iteration root in isolation, drop a fabric-score.json there
      fs.writeFileSync(path.join(iter, 'fabric-score.json'), '{}');
      expect(resolveLoopRoot(iter)).toBe(d);
    } finally { rm(d); }
  });

  it('throws on ambiguous input', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'iter-001'));
      fs.writeFileSync(path.join(d, 'fabric-score.json'), '{}');
      expect(() => resolveLoopRoot(d)).toThrow(/ambiguous/);
    } finally { rm(d); }
  });

  it('throws on unknown input', () => {
    const d = tmp();
    try {
      fs.writeFileSync(path.join(d, 'random.txt'), 'x');
      expect(() => resolveLoopRoot(d)).toThrow(/does not look like/);
    } finally { rm(d); }
  });
});

describe('resolveIterRoot', () => {
  it('returns iterRoot unchanged when given an iterRoot', () => {
    const d = tmp();
    try {
      const iter = path.join(d, 'iter-002');
      fs.mkdirSync(iter);
      fs.writeFileSync(path.join(iter, 'fabric-score.json'), '{}');
      expect(resolveIterRoot(iter)).toBe(iter);
    } finally { rm(d); }
  });

  it('returns latest iter when given a loopRoot with multiple iters', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'iter-001'));
      fs.mkdirSync(path.join(d, 'iter-002'));
      fs.mkdirSync(path.join(d, 'iter-003'));
      expect(resolveIterRoot(d)).toBe(path.join(d, 'iter-003'));
    } finally { rm(d); }
  });

  it('returns specific iter when iteration arg is given', () => {
    const d = tmp();
    try {
      fs.mkdirSync(path.join(d, 'iter-001'));
      fs.mkdirSync(path.join(d, 'iter-002'));
      expect(resolveIterRoot(d, 1)).toBe(path.join(d, 'iter-001'));
    } finally { rm(d); }
  });

  it('returns iter-001 placeholder for an empty loop dir', () => {
    const d = tmp();
    try {
      expect(resolveIterRoot(d)).toBe(path.join(d, 'iter-001'));
    } finally { rm(d); }
  });
});

describe('resolveLoopPaths (existing — sanity)', () => {
  it('still works for callers that pass loopRoot + iterNum', () => {
    const paths = resolveLoopPaths('/tmp/foo', 1);
    expect(paths.iterRoot).toBe('/tmp/foo/iter-001');
    expect(paths.fabricScorePath).toBe('/tmp/foo/iter-001/fabric-score.json');
  });
});
