import type { Reporter, FabricReport } from '../adapters';
import type { FabricScore } from '../score';

export interface SlackReporterOptions {
  webhookUrl: string;
  /** Channel to post to (e.g. '#qa-fabric'). Optional — Slack uses the webhook's default. */
  channel?: string;
  /** Minimum overall score that is considered passing. Adds a ✅/❌ prefix. Default: 8.0 */
  threshold?: number;
  /** Product name shown in the header. Default: 'Fabric' */
  productName?: string;
}

/**
 * Posts a fabric score summary to Slack via an incoming webhook.
 *
 * Wire it in fabric.config.ts:
 *
 *   reporters: [
 *     new SlackReporter({
 *       webhookUrl: process.env.SLACK_FABRIC_WEBHOOK!,
 *       threshold: 8.0,
 *       productName: 'MyApp',
 *     }),
 *   ],
 */
export class SlackReporter implements Reporter {
  private readonly opts: Required<SlackReporterOptions>;

  constructor(options: SlackReporterOptions) {
    this.opts = {
      channel:     options.channel     ?? '',
      threshold:   options.threshold   ?? 8.0,
      productName: options.productName ?? 'Fabric',
      webhookUrl:  options.webhookUrl,
    };
  }

  async report(score: FabricScore, _iterRoot: string): Promise<FabricReport> {
    const { overall, dimensions, flakiness, adversarial } = score;
    const passing = overall >= this.opts.threshold;
    const icon    = passing ? '✅' : '❌';
    const bar     = scoreBar(overall);

    const lines: string[] = [
      `${icon} *${this.opts.productName} Fabric Score: ${overall.toFixed(1)}/10* ${bar}`,
      '',
      `• Coverage delta:    ${fmt(dimensions.coverage_delta)}`,
      `• Fixture health:    ${fmt(dimensions.fixture_health)}`,
      `• Regression health: ${fmt(dimensions.regression_health)}`,
      `• Flow coverage:     ${fmt(dimensions.flow_coverage)}`,
      `• Discovery yield:   ${fmt(dimensions.discovery_yield)}`,
      `• Persona realism:   ${fmt(dimensions.persona_realism)}`,
    ];

    if (flakiness?.quarantinedFlows.length) {
      lines.push('', `⚠️  Quarantined flows (${flakiness.quarantinedFlows.length}): ${flakiness.quarantinedFlows.slice(0, 3).join(', ')}${flakiness.quarantinedFlows.length > 3 ? '…' : ''}`);
    }

    if (adversarial?.violationsFound) {
      lines.push('', `🔴 Adversarial violations found: ${adversarial.violationsFound}`);
      adversarial.topViolations.slice(0, 3).forEach((v) => lines.push(`  • ${v}`));
    }

    const text = lines.join('\n');

    const payload: Record<string, unknown> = { text };
    if (this.opts.channel) payload.channel = this.opts.channel;

    try {
      const res = await fetch(this.opts.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn(`[SlackReporter] Webhook returned ${res.status} — message may not have posted`);
      }
    } catch (err) {
      console.warn(`[SlackReporter] Failed to post to Slack (non-fatal): ${err}`);
    }

    return { format: 'console', content: text };
  }
}

function fmt(n: number): string {
  return n.toFixed(1).padStart(4);
}

function scoreBar(score: number): string {
  const filled = Math.round(score);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}
