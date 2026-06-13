import { generateInputs } from './schema-gen';

describe('generateInputs (#44 schema consumer)', () => {
  it('object: valid has required fields; invalid drops one and mistypes another', () => {
    const s = { type: 'object', properties: { a: { type: 'string' }, b: { type: 'number' } }, required: ['a', 'b'] };
    const r = generateInputs(s);
    expect(r.valid).toEqual({ a: 'x', b: 0 });
    expect(r.invalid.some((i) => i.reason === 'missing required field: a')).toBe(true);
    expect(r.invalid.some((i) => i.reason.startsWith('wrong type for field'))).toBe(true);
  });

  it('enum → valid is the first member; invalid includes a non-member', () => {
    const r = generateInputs({ enum: ['red', 'green'] });
    expect(r.valid).toBe('red');
    expect(r.invalid.some((i) => i.reason === 'value not in enum')).toBe(true);
  });

  it('nested object + array of strings', () => {
    const s = {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        meta: { type: 'object', properties: { x: { type: 'boolean' } }, required: ['x'] },
      },
      required: ['tags', 'meta'],
    };
    expect(generateInputs(s).valid).toEqual({ tags: ['x'], meta: { x: true } });
  });

  it('resolves a local $ref (#/$defs)', () => {
    const root = {
      $defs: { Name: { type: 'string' } },
      type: 'object',
      properties: { n: { $ref: '#/$defs/Name' } },
      required: ['n'],
    };
    expect(generateInputs(root).valid).toEqual({ n: 'x' });
  });

  it('anyOf picks the first branch; default is honored', () => {
    expect(generateInputs({ anyOf: [{ type: 'string' }, { type: 'number' }] }).valid).toBe('x');
    expect(generateInputs({ type: 'string', default: 'D' }).valid).toBe('D');
  });

  it('reports unsupported constructs explicitly', () => {
    const r = generateInputs({ type: 'object', patternProperties: { '^x': { type: 'string' } }, if: {}, then: {} });
    expect(r.unsupported).toEqual(expect.arrayContaining(['if', 'patternProperties', 'then']));
  });

  it('reports a non-local $ref as unsupported', () => {
    const r = generateInputs({ $ref: 'https://example.com/schema' });
    expect(r.unsupported.some((u) => u.startsWith('$ref:'))).toBe(true);
  });

  it('merges allOf object members into one valid input (all must hold)', () => {
    const s = {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
      ],
    };
    const r = generateInputs(s);
    expect(r.valid).toEqual({ a: 'x', b: 0 });
    expect(r.unsupported).toEqual([]);
    expect(r.invalid.some((i) => i.reason.startsWith('missing required field'))).toBe(true);
  });

  it('reports a non-object allOf member as unsupported', () => {
    const r = generateInputs({ allOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'string' }] });
    expect(r.unsupported).toContain('allOf:non-object-member');
  });

  it('generates a const-violating invalid input', () => {
    const r = generateInputs({ const: 'fixed' });
    expect(r.valid).toBe('fixed');
    expect(r.invalid.some((i) => i.reason === 'value !== const')).toBe(true);
  });

  it('respects minItems and minLength', () => {
    const r = generateInputs({ type: 'array', items: { type: 'string' }, minItems: 2 });
    expect(r.valid).toEqual(['x', 'x']);
    expect(generateInputs({ type: 'string', minLength: 3 }).valid).toBe('xxx');
  });
});
