export interface FabricScore {
  simulationId: string;
  generatedAt: string;
  overall: number;
  dimensions: {
    persona_realism: number;
    coverage_delta: number;
    fixture_health: number;
    discovery_yield: number;
    regression_health: number;
    flow_coverage: number;
  };
  /** Flakiness summary — populated when FlakinessTracker is wired. */
  flakiness?: {
    quarantinedFlows: string[];
    topFlaky: Array<{
      flowName: string;
      failureRate: number;
      total: number;
      quarantined: boolean;
    }>;
  };
  /** Adversarial probe summary — populated when adversarial personas ran. */
  adversarial?: {
    probesAttempted: number;
    violationsFound: number;
    topViolations: string[];
  };
  details: Record<string, unknown>;
}
