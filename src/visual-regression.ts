import * as fs from 'fs';
import * as path from 'path';
import Pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VisualRegressionOptions {
  /**
   * Directory where baseline screenshots are stored (persists across runs).
   * Defaults to `.fab-baselines` in process.cwd().
   * Commit this directory for small projects; gitignore + CI-artifact for large ones.
   */
  baselineDir?: string;
  /**
   * Per-iteration directory where current-run screenshots and diffs are written.
   * Typically `<iterRoot>/visual-results/`.
   */
  iterRoot: string;
  /**
   * Pixel diff threshold per pixel (0–1). Default: 0.1 (10% per-pixel tolerance).
   * Separate from the overall diff threshold — this is per-pixel sensitivity.
   */
  pixelThreshold?: number;
  /**
   * Overall diff threshold: fraction of pixels that must differ to count as a
   * regression (0–1). Default: 0.02 (2%).
   */
  diffThreshold?: number;
}

export interface VisualDiffResult {
  name: string;
  baselinePath: string;
  currentPath: string;
  diffPath: string;
  diffPixels: number;
  totalPixels: number;
  diffPercent: number;
  isRegression: boolean;
  /** True if no baseline existed — current screenshot saved as new baseline. */
  isNewBaseline: boolean;
}

export interface VisualReportSummary {
  totalChecked: number;
  regressions: VisualDiffResult[];
  newBaselines: VisualDiffResult[];
  passed: VisualDiffResult[];
}

// ---------------------------------------------------------------------------
// VisualRegression
// ---------------------------------------------------------------------------

/**
 * Screenshot baseline comparison for Playwright specs.
 *
 * Use inside a BrowserAdapter's runSpecs() or directly in Playwright spec files:
 *
 *   const vr = new VisualRegression({ iterRoot, baselineDir: '.fab-baselines' });
 *
 *   // Capture current screenshot (saves to iterRoot/visual-results/<name>/current.png)
 *   await vr.capture(page, 'login-page');
 *
 *   // Compare to baseline — saves diff image, returns result
 *   const result = await vr.compare('login-page');
 *   if (result.isRegression) {
 *     throw new Error(`Visual regression on ${result.name}: ${(result.diffPercent * 100).toFixed(1)}% diff`);
 *   }
 *
 * On the first run (no baseline), capture() saves the screenshot as the baseline
 * automatically and compare() returns isNewBaseline=true (not a regression).
 *
 * fab baseline update <flow>  — accept current screenshot as new baseline
 * fab baseline list           — show all baselines with last-updated timestamp
 * fab baseline reset          — wipe all baselines for a clean re-capture
 */
export class VisualRegression {
  private readonly baselineDir: string;
  private readonly resultsDir: string;
  private readonly pixelThreshold: number;
  private readonly diffThreshold: number;
  private readonly results: VisualDiffResult[] = [];

  constructor(options: VisualRegressionOptions) {
    this.baselineDir   = path.resolve(options.baselineDir ?? path.join(process.cwd(), '.fab-baselines'));
    this.resultsDir    = path.join(options.iterRoot, 'visual-results');
    this.pixelThreshold = options.pixelThreshold ?? 0.1;
    this.diffThreshold  = options.diffThreshold  ?? 0.02;
  }

  /**
   * Capture a screenshot from a Playwright page and save it as the current
   * screenshot for this run. Accepts any object with a `screenshot()` method
   * so the framework doesn't need a hard dep on @playwright/test.
   */
  async capture(
    page: { screenshot(opts?: { path?: string; type?: string }): Promise<Buffer> },
    name: string,
  ): Promise<void> {
    const dir = path.join(this.resultsDir, name);
    fs.mkdirSync(dir, { recursive: true });
    const buf = await page.screenshot({ type: 'png' });
    fs.writeFileSync(currentPath(this.resultsDir, name), buf);
  }

  /**
   * Compare the current screenshot for `name` against its baseline.
   *
   * - If no baseline exists: saves current as baseline, returns isNewBaseline=true
   * - If baseline exists: diffs, saves diff image, returns isRegression if diffPercent > threshold
   */
  compare(name: string): VisualDiffResult {
    const bPath = baselinePath(this.baselineDir, name);
    const cPath = currentPath(this.resultsDir, name);
    const dPath = diffImagePath(this.resultsDir, name);

    if (!fs.existsSync(cPath)) {
      throw new Error(`[VisualRegression] No current screenshot for '${name}'. Call capture() first.`);
    }

    // First run — save as baseline, not a regression
    if (!fs.existsSync(bPath)) {
      fs.mkdirSync(path.dirname(bPath), { recursive: true });
      fs.copyFileSync(cPath, bPath);
      const result: VisualDiffResult = {
        name,
        baselinePath: bPath,
        currentPath:  cPath,
        diffPath:     '',
        diffPixels:   0,
        totalPixels:  0,
        diffPercent:  0,
        isRegression: false,
        isNewBaseline: true,
      };
      this.results.push(result);
      return result;
    }

    // Compare
    const baseline = PNG.sync.read(fs.readFileSync(bPath));
    const current  = PNG.sync.read(fs.readFileSync(cPath));

    const { width, height } = baseline;
    const diff = new PNG({ width, height });

    let diffPixels = 0;
    try {
      diffPixels = Pixelmatch(
        baseline.data,
        current.data,
        diff.data,
        width,
        height,
        { threshold: this.pixelThreshold, includeAA: false },
      );
    } catch {
      // Dimension mismatch — treat as full regression
      diffPixels = width * height;
    }

    fs.mkdirSync(path.dirname(dPath), { recursive: true });
    fs.writeFileSync(dPath, PNG.sync.write(diff));

    const totalPixels = width * height;
    const diffPercent = totalPixels > 0 ? diffPixels / totalPixels : 0;

    const result: VisualDiffResult = {
      name,
      baselinePath: bPath,
      currentPath:  cPath,
      diffPath:     dPath,
      diffPixels,
      totalPixels,
      diffPercent,
      isRegression: diffPercent > this.diffThreshold,
      isNewBaseline: false,
    };
    this.results.push(result);
    return result;
  }

  /**
   * Accept the current screenshot as the new baseline for `name`.
   * Equivalent to `fab baseline update <name>`.
   */
  update(name: string): void {
    const cPath = currentPath(this.resultsDir, name);
    const bPath = baselinePath(this.baselineDir, name);
    if (!fs.existsSync(cPath)) {
      throw new Error(`[VisualRegression] No current screenshot for '${name}'. Run the flow first.`);
    }
    fs.mkdirSync(path.dirname(bPath), { recursive: true });
    fs.copyFileSync(cPath, bPath);
  }

  /** Summary of all comparisons performed in this session. */
  getSummary(): VisualReportSummary {
    return {
      totalChecked: this.results.length,
      regressions:  this.results.filter((r) => r.isRegression),
      newBaselines: this.results.filter((r) => r.isNewBaseline),
      passed:       this.results.filter((r) => !r.isRegression && !r.isNewBaseline),
    };
  }

  /** Write summary JSON to iterRoot/visual-results/summary.json. */
  writeSummary(): VisualReportSummary {
    const summary = this.getSummary();
    fs.mkdirSync(this.resultsDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.resultsDir, 'summary.json'),
      JSON.stringify(summary, null, 2),
    );
    return summary;
  }
}

// ---------------------------------------------------------------------------
// Baseline management helpers (used by fab baseline commands)
// ---------------------------------------------------------------------------

export function listBaselines(baselineDir: string): Array<{ name: string; updatedAt: Date }> {
  if (!fs.existsSync(baselineDir)) return [];
  const results: Array<{ name: string; updatedAt: Date }> = [];

  function walk(dir: string, prefix: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else if (entry.name === 'baseline.png') {
        const stat = fs.statSync(path.join(dir, entry.name));
        results.push({ name: prefix, updatedAt: stat.mtime });
      }
    }
  }

  walk(baselineDir, '');
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

export function updateBaseline(baselineDir: string, name: string, sourcePng: string): void {
  const dest = baselinePath(baselineDir, name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(sourcePng, dest);
}

export function resetBaselines(baselineDir: string): void {
  if (fs.existsSync(baselineDir)) {
    fs.rmSync(baselineDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

function baselinePath(baselineDir: string, name: string): string {
  return path.join(baselineDir, name, 'baseline.png');
}

function currentPath(resultsDir: string, name: string): string {
  return path.join(resultsDir, name, 'current.png');
}

function diffImagePath(resultsDir: string, name: string): string {
  return path.join(resultsDir, name, 'diff.png');
}
