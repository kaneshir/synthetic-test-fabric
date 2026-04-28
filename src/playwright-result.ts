import * as fs from 'fs';
import * as path from 'path';

export interface PlaywrightFailedFlow {
  spec_title: string;
  spec_file: string;
  screen_path: string;
  failure_reason: string;
}

export interface PlaywrightAgentResult {
  exitCode: number;
  total: number;
  passed: number;
  failed: number;
  failed_flows: PlaywrightFailedFlow[];
  flowResultsPath: string;
}

// ---------------------------------------------------------------------------
// Playwright JSON report parsing
// ---------------------------------------------------------------------------

interface PwSpec {
  title?: string;
  ok?: boolean;
  tests?: Array<{ results?: Array<{ error?: { message?: string } }> }>;
}

interface PwSuite {
  title?: string;
  file?: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}

interface PwReport {
  stats?: { expected?: number; unexpected?: number; flaky?: number };
  suites?: PwSuite[];
}

function collectSpecs(
  suite: PwSuite,
  titles: string[] = [],
  inheritedFile = '',
): Array<PwSpec & { fullTitle: string; specFile: string }> {
  const out: Array<PwSpec & { fullTitle: string; specFile: string }> = [];
  const specFile = suite.file ?? inheritedFile;
  const prefix = titles.length ? titles.join(' > ') + ' > ' : '';
  for (const spec of suite.specs ?? []) {
    out.push({ ...spec, fullTitle: `${prefix}${spec.title ?? ''}`.trim(), specFile });
  }
  for (const child of suite.suites ?? []) {
    out.push(...collectSpecs(child, [...titles, child.title ?? ''], specFile));
  }
  return out;
}

/**
 * Parse a Playwright JSON reporter output file into a typed PlaywrightAgentResult.
 * Returns a zero-result object when the file is absent rather than throwing, so
 * the orchestrator can still proceed when no generated specs exist yet.
 */
export function parsePlaywrightResults(jsonPath: string): PlaywrightAgentResult {
  if (!fs.existsSync(jsonPath)) {
    return { exitCode: 0, total: 0, passed: 0, failed: 0, failed_flows: [], flowResultsPath: jsonPath };
  }

  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as PwReport;

  let total = 0;
  let passed = 0;

  if (raw.stats && typeof raw.stats.expected === 'number') {
    const unexpected = raw.stats.unexpected ?? 0;
    const flaky = raw.stats.flaky ?? 0;
    passed = raw.stats.expected;
    total = passed + unexpected + flaky;
  } else {
    const allSpecs = (raw.suites ?? []).flatMap((s) => collectSpecs(s));
    total = allSpecs.length;
    passed = allSpecs.filter((s) => s.ok).length;
  }

  const allSpecs = (raw.suites ?? []).flatMap((s) => collectSpecs(s));
  const failed_flows: PlaywrightFailedFlow[] = allSpecs
    .filter((s) => !s.ok)
    .map((s) => {
      const firstError = s.tests?.[0]?.results?.[0]?.error?.message ?? '';
      const specFile = s.specFile || jsonPath;
      return {
        spec_title: s.fullTitle,
        spec_file: specFile,
        screen_path: specFilenameToScreenPath(specFile),
        failure_reason: firstError.slice(0, 300),
      };
    });

  return {
    exitCode: total - passed > 0 ? 1 : 0,
    total,
    passed,
    failed: total - passed,
    failed_flows,
    flowResultsPath: jsonPath,
  };
}

/**
 * Derive a normalized screen path label from a generated spec filename.
 * Example: flows/generated/stub_seeker_jobs_job_detail.spec.ts → seeker/jobs/job_detail
 */
export function specFilenameToScreenPath(filename: string): string {
  const base = path.basename(filename).replace(/\.spec\.ts$/, '');
  const stripped = base.startsWith('stub_') ? base.slice(5) : base;
  return stripped.replace(/_/g, '/');
}
