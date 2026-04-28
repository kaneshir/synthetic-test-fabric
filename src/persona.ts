import { z } from 'zod';

function scoreToLevel(v: number): 'low' | 'medium' | 'high' {
  if (v < 0.4) return 'low';
  if (v < 0.7) return 'medium';
  return 'high';
}

const PressureYAMLSchema = z.object({
  financial:      z.number().min(0).max(1),
  urgency:        z.number().min(0).max(1),
  risk_tolerance: z.number().min(0).max(1).default(0.5),
});

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slug = z.string().trim().regex(SLUG_RE, 'must be a lowercase slug (e.g. "maria-chen")');
const nonBlank = z.string().trim().min(1, 'must not be blank');

const PersonaYAMLSchema = z.object({
  schema_version: z.literal(1),
  id:             slug,
  role:           z.string().trim().min(1, 'must not be blank'),
  display_name:   nonBlank,
  backstory:      z.string().optional(),
  trade:          z.string().optional(),
  goals:          z.array(nonBlank).min(1),
  constraints:    z.array(nonBlank).default([]),
  pressure:       PressureYAMLSchema,
  adversarial:    z.boolean().optional(),
  // Employer-specific
  company_size:   z.enum(['small', 'medium', 'large']).optional(),
  hiring_urgency: z.number().min(0).max(1).optional(),
});

export interface PersonaDefinition {
  id: string;
  role: string;
  displayName: string;
  backstory?: string;
  trade?: string;
  goals: string[];
  constraints: string[];
  pressure: {
    financial: number;
    financialPressure: 'low' | 'medium' | 'high';
    urgency: number;
    riskTolerance: number;
  };
  companySize?: 'small' | 'medium' | 'large';
  hiringUrgency?: number;
  /**
   * When true, this persona actively probes for validation gaps, submits
   * invalid data, attempts unauthorized routes, and hammers rate limits.
   * Failures are recorded with event_kind='adversarial_probe' so they can
   * be tracked separately from normal flow failures.
   */
  adversarial?: boolean;
}

export function parsePersonaYAML(raw: unknown): PersonaDefinition {
  const parsed = PersonaYAMLSchema.parse(raw);
  return {
    id:          parsed.id,
    role:        parsed.role,
    displayName: parsed.display_name,
    backstory:   parsed.backstory,
    trade:       parsed.trade,
    goals:       parsed.goals,
    constraints: parsed.constraints,
    pressure: {
      financial:         parsed.pressure.financial,
      financialPressure: scoreToLevel(parsed.pressure.financial),
      urgency:           parsed.pressure.urgency,
      riskTolerance:     parsed.pressure.risk_tolerance,
    },
    companySize:   parsed.company_size,
    hiringUrgency: parsed.hiring_urgency,
    adversarial:   parsed.adversarial,
  };
}
