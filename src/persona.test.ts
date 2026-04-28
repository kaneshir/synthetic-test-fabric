import { parsePersonaYAML } from './persona';

const VALID_SEEKER = {
  schema_version: 1,
  id: 'maria-chen',
  role: 'seeker',
  display_name: 'Maria Chen',
  backstory: 'Electrician apprentice hopeful',
  trade: 'electrical',
  goals: ['get hired', 'complete apprenticeship'],
  constraints: ['no travel'],
  pressure: { financial: 0.8, urgency: 0.6, risk_tolerance: 0.3 },
};

const VALID_EMPLOYER = {
  schema_version: 1,
  id: 'acme-corp',
  role: 'employer',
  display_name: 'Acme Corp',
  goals: ['hire two apprentices'],
  pressure: { financial: 0.2, urgency: 0.5 },
  company_size: 'small',
  hiring_urgency: 0.7,
};

describe('parsePersonaYAML', () => {
  it('normalizes display_name → displayName', () => {
    const def = parsePersonaYAML(VALID_SEEKER);
    expect(def.displayName).toBe('Maria Chen');
    expect((def as any).display_name).toBeUndefined();
  });

  it('pressure.financial = 0.8 → financialPressure = "high"', () => {
    const def = parsePersonaYAML(VALID_SEEKER);
    expect(def.pressure.financialPressure).toBe('high');
    expect(def.pressure.financial).toBe(0.8);
  });

  it('pressure.financial = 0.2 → financialPressure = "low"', () => {
    const def = parsePersonaYAML(VALID_EMPLOYER);
    expect(def.pressure.financialPressure).toBe('low');
  });

  it('pressure.financial = 0.55 → financialPressure = "medium"', () => {
    const def = parsePersonaYAML({ ...VALID_SEEKER, pressure: { financial: 0.55, urgency: 0.4 } });
    expect(def.pressure.financialPressure).toBe('medium');
  });

  it('normalizes company_size → companySize and hiring_urgency → hiringUrgency', () => {
    const def = parsePersonaYAML(VALID_EMPLOYER);
    expect(def.companySize).toBe('small');
    expect(def.hiringUrgency).toBe(0.7);
    expect((def as any).company_size).toBeUndefined();
  });

  it('risk_tolerance defaults to 0.5 when omitted', () => {
    const def = parsePersonaYAML(VALID_EMPLOYER);
    expect(def.pressure.riskTolerance).toBe(0.5);
  });

  it('constraints defaults to [] when omitted', () => {
    const def = parsePersonaYAML(VALID_EMPLOYER);
    expect(def.constraints).toEqual([]);
  });

  it('throws on missing schema_version', () => {
    const { schema_version: _sv, ...noVersion } = VALID_SEEKER as any;
    expect(() => parsePersonaYAML(noVersion)).toThrow();
  });

  it('throws on wrong schema_version', () => {
    expect(() => parsePersonaYAML({ ...VALID_SEEKER, schema_version: 2 })).toThrow();
  });

  it('throws on missing goals', () => {
    const { goals: _g, ...noGoals } = VALID_SEEKER as any;
    expect(() => parsePersonaYAML(noGoals)).toThrow();
  });

  it('throws on empty goals array', () => {
    expect(() => parsePersonaYAML({ ...VALID_SEEKER, goals: [] })).toThrow();
  });

  it('accepts any non-empty role string', () => {
    expect(() => parsePersonaYAML({ ...VALID_SEEKER, role: 'admin' })).not.toThrow();
    expect(() => parsePersonaYAML({ ...VALID_SEEKER, role: 'customer' })).not.toThrow();
  });

  it('throws on empty role', () => {
    expect(() => parsePersonaYAML({ ...VALID_SEEKER, role: '' })).toThrow();
  });

  it('passes through backstory and trade', () => {
    const def = parsePersonaYAML(VALID_SEEKER);
    expect(def.backstory).toBe('Electrician apprentice hopeful');
    expect(def.trade).toBe('electrical');
  });

  describe('id slug validation', () => {
    it('throws on empty id', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, id: '' })).toThrow();
    });

    it('throws on whitespace-only id', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, id: '   ' })).toThrow();
    });

    it('throws on id with uppercase letters', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, id: 'Maria-Chen' })).toThrow();
    });

    it('throws on id with spaces', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, id: 'maria chen' })).toThrow();
    });

    it('throws on id with trailing hyphen', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, id: 'maria-' })).toThrow();
    });

    it('accepts valid slug ids', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, id: 'a' })).not.toThrow();
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, id: 'maria-chen' })).not.toThrow();
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, id: 'worker-123' })).not.toThrow();
    });
  });

  describe('blank string rejection', () => {
    it('throws on blank display_name', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, display_name: '' })).toThrow();
    });

    it('throws on whitespace-only display_name', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, display_name: '   ' })).toThrow();
    });

    it('throws on blank goal string in goals array', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, goals: ['valid goal', ''] })).toThrow();
    });

    it('throws on whitespace-only goal string', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, goals: ['valid goal', '   '] })).toThrow();
    });

    it('throws on blank constraint string', () => {
      expect(() => parsePersonaYAML({ ...VALID_SEEKER, constraints: [''] })).toThrow();
    });
  });
});
