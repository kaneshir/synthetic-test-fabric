import * as fs from 'fs';
import * as path from 'path';
import type { Reporter, FabricReport } from '../adapters';
import type { FabricScore } from '../score';
import type { VisualReportSummary } from '../visual-regression';

export interface HtmlReporterOptions {
  /**
   * Directory where the HTML report is written.
   * Defaults to `<iterRoot>/reports/`.
   */
  outputDir?: string;
  /** Product name shown in the report header. Default: 'Fabric' */
  productName?: string;
}

/**
 * Generates a self-contained HTML report covering:
 *   - Overall fabric score + dimension breakdown
 *   - Score trend chart (last 30 iterations from loopRoot)
 *   - Visual regression diffs (before/after/diff inline images)
 *   - Flakiness summary
 *   - Adversarial probe summary
 *
 * Output: <iterRoot>/reports/fabric-report.html (or outputDir if set)
 *
 * Wire in fabric.config.ts:
 *   reporters: [new HtmlReporter({ productName: 'MyApp' })]
 */
export class HtmlReporter implements Reporter {
  private readonly opts: Required<HtmlReporterOptions>;

  constructor(options: HtmlReporterOptions = {}) {
    this.opts = {
      outputDir:   options.outputDir   ?? '',
      productName: options.productName ?? 'Fabric',
    };
  }

  async report(score: FabricScore, iterRoot: string): Promise<FabricReport> {
    const outputDir = this.opts.outputDir || path.join(iterRoot, 'reports');
    fs.mkdirSync(outputDir, { recursive: true });

    const trendData  = this.loadTrendData(iterRoot, score);
    const visualData = this.loadVisualData(iterRoot);

    const html = buildHtml({
      productName: this.opts.productName,
      score,
      trendData,
      visualData,
    });

    const outPath = path.join(outputDir, 'fabric-report.html');
    fs.writeFileSync(outPath, html, 'utf8');

    return { format: 'console', content: `HTML report: ${outPath}` };
  }

  private loadTrendData(iterRoot: string, current: FabricScore): TrendPoint[] {
    // Walk loopRoot looking for fabric-score.json in sibling iter dirs
    const loopRoot = path.dirname(iterRoot);
    const points: TrendPoint[] = [];

    try {
      const dirs = fs.readdirSync(loopRoot)
        .filter((d) => /^iter-\d+$/.test(d))
        .sort();

      for (const dir of dirs.slice(-30)) {  // last 30 iterations
        const scorePath = path.join(loopRoot, dir, 'fabric-score.json');
        if (fs.existsSync(scorePath)) {
          try {
            const s = JSON.parse(fs.readFileSync(scorePath, 'utf8')) as FabricScore;
            points.push({ label: dir, overall: s.overall, generatedAt: s.generatedAt });
          } catch { /* skip malformed */ }
        }
      }
    } catch { /* loopRoot may not have iter dirs in single-run mode */ }

    // Always include current even if file not written yet
    if (!points.find((p) => p.generatedAt === current.generatedAt)) {
      points.push({ label: 'current', overall: current.overall, generatedAt: current.generatedAt });
    }

    return points;
  }

  private loadVisualData(iterRoot: string): VisualReportSummary | null {
    const summaryPath = path.join(iterRoot, 'visual-results', 'summary.json');
    if (!fs.existsSync(summaryPath)) return null;
    try {
      return JSON.parse(fs.readFileSync(summaryPath, 'utf8')) as VisualReportSummary;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

interface TrendPoint {
  label: string;
  overall: number;
  generatedAt: string;
}

function buildHtml(ctx: {
  productName: string;
  score: FabricScore;
  trendData: TrendPoint[];
  visualData: VisualReportSummary | null;
}): string {
  const { productName, score, trendData, visualData } = ctx;
  const passing = score.overall >= 8.0;
  const statusColor = passing ? '#22c55e' : '#ef4444';

  const trendLabels = JSON.stringify(trendData.map((p) => p.label));
  const trendValues = JSON.stringify(trendData.map((p) => p.overall));

  const dimensionRows = Object.entries(score.dimensions)
    .map(([k, v]) => {
      const pct = ((v as number) / 10) * 100;
      const color = (v as number) >= 8 ? '#22c55e' : (v as number) >= 6 ? '#f59e0b' : '#ef4444';
      return `
        <tr>
          <td>${k.replace(/_/g, ' ')}</td>
          <td>${(v as number).toFixed(1)}</td>
          <td><div class="bar-bg"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div></td>
        </tr>`;
    }).join('');

  const flakinessSection = score.flakiness?.quarantinedFlows.length
    ? `<section>
        <h2>Flakiness (${score.flakiness.quarantinedFlows.length} quarantined)</h2>
        <table>
          <thead><tr><th>Flow</th><th>Failure Rate</th><th>Runs</th><th>Status</th></tr></thead>
          <tbody>
            ${(score.flakiness.topFlaky ?? []).map((f) => `
              <tr>
                <td>${f.flowName}</td>
                <td>${(f.failureRate * 100).toFixed(0)}%</td>
                <td>${f.total}</td>
                <td>${f.quarantined ? '<span class="badge red">quarantined</span>' : '<span class="badge yellow">flaky</span>'}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </section>`
    : '';

  const adversarialSection = score.adversarial?.violationsFound
    ? `<section>
        <h2>Adversarial Probes</h2>
        <p>${score.adversarial.probesAttempted} probes attempted — <strong>${score.adversarial.violationsFound} violations found</strong></p>
        <ul>${score.adversarial.topViolations.map((v) => `<li>${v}</li>`).join('')}</ul>
      </section>`
    : '';

  const visualSection = visualData
    ? `<section>
        <h2>Visual Regression (${visualData.regressions.length} regression${visualData.regressions.length !== 1 ? 's' : ''})</h2>
        ${visualData.regressions.length === 0
          ? '<p class="ok">No visual regressions detected.</p>'
          : visualData.regressions.map((r) => `
              <div class="vr-block">
                <h3>${r.name} — <span style="color:#ef4444">${(r.diffPercent * 100).toFixed(1)}% diff</span></h3>
                <div class="vr-images">
                  ${inlineImg(r.baselinePath, 'Baseline')}
                  ${inlineImg(r.currentPath, 'Current')}
                  ${inlineImg(r.diffPath, 'Diff')}
                </div>
              </div>`).join('')}
        ${visualData.newBaselines.length
          ? `<p class="muted">${visualData.newBaselines.length} new baseline(s) captured.</p>`
          : ''}
      </section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${productName} Fabric Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #0f172a; color: #e2e8f0; }
  h1 { font-size: 1.8rem; margin-bottom: 4px; }
  h2 { font-size: 1.2rem; color: #94a3b8; border-bottom: 1px solid #1e293b; padding-bottom: 8px; margin-top: 32px; }
  h3 { font-size: 1rem; margin: 16px 0 8px; }
  section { margin-top: 32px; }
  .score-hero { font-size: 4rem; font-weight: 700; color: ${statusColor}; }
  .status { font-size: 1.1rem; color: ${statusColor}; margin-bottom: 24px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #1e293b; font-size: 0.9rem; }
  th { color: #64748b; font-weight: 600; }
  .bar-bg { background: #1e293b; border-radius: 4px; height: 8px; width: 120px; }
  .bar-fill { height: 8px; border-radius: 4px; }
  .badge { padding: 2px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: 600; }
  .badge.red { background: #450a0a; color: #fca5a5; }
  .badge.yellow { background: #451a03; color: #fcd34d; }
  .ok { color: #22c55e; }
  .muted { color: #64748b; font-size: 0.85rem; }
  .vr-block { margin: 16px 0; padding: 16px; background: #1e293b; border-radius: 8px; }
  .vr-images { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
  .vr-images figure { margin: 0; text-align: center; }
  .vr-images figcaption { font-size: 0.75rem; color: #64748b; margin-top: 4px; }
  .vr-images img { max-width: 280px; border-radius: 4px; border: 1px solid #334155; }
  canvas { background: #1e293b; border-radius: 8px; padding: 16px; max-height: 240px; }
</style>
</head>
<body>
<h1>${productName} Fabric Report</h1>
<div class="score-hero">${score.overall.toFixed(1)}<span style="font-size:2rem;color:#64748b">/10</span></div>
<div class="status">${passing ? '✅ Passing' : '❌ Below threshold'}</div>

<section>
  <h2>Dimensions</h2>
  <table>
    <thead><tr><th>Dimension</th><th>Score</th><th>Health</th></tr></thead>
    <tbody>${dimensionRows}</tbody>
  </table>
</section>

${trendData.length > 1 ? `
<section>
  <h2>Score Trend (last ${trendData.length} iterations)</h2>
  <canvas id="trend"></canvas>
  <script>
    new Chart(document.getElementById('trend'), {
      type: 'line',
      data: {
        labels: ${trendLabels},
        datasets: [{
          label: 'Overall Score',
          data: ${trendValues},
          borderColor: '#6366f1',
          backgroundColor: 'rgba(99,102,241,0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
        }]
      },
      options: {
        scales: {
          y: { min: 0, max: 10, ticks: { color: '#64748b' }, grid: { color: '#1e293b' } },
          x: { ticks: { color: '#64748b' }, grid: { color: '#1e293b' } }
        },
        plugins: { legend: { labels: { color: '#e2e8f0' } } }
      }
    });
  </script>
</section>` : ''}

${flakinessSection}
${adversarialSection}
${visualSection}

<p class="muted" style="margin-top:48px">Generated ${new Date(score.generatedAt).toLocaleString()} · simulation ${score.simulationId}</p>
</body>
</html>`;
}

function inlineImg(imgPath: string, label: string): string {
  if (!imgPath || !fs.existsSync(imgPath)) {
    return `<figure><div style="width:180px;height:120px;background:#0f172a;border-radius:4px;display:flex;align-items:center;justify-content:center;color:#475569;font-size:.75rem">no image</div><figcaption>${label}</figcaption></figure>`;
  }
  const b64 = fs.readFileSync(imgPath).toString('base64');
  return `<figure><img src="data:image/png;base64,${b64}" alt="${label}"><figcaption>${label}</figcaption></figure>`;
}
