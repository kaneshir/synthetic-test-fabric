/**
 * JSON-Schema input generator (#44) — consumes an MCP tool's `inputSchema` and
 * produces (a) a schema-valid instance to drive coverage and (b) boundary-invalid
 * instances to drive schema-violation probes. Unsupported constructs are
 * reported explicitly rather than silently skipped.
 *
 * This is a schema *consumer / input generator* — distinct from the zod→JSON-Schema
 * *producer* in `src/mcp/server.ts`. Deterministic (no RNG) so runs are reproducible.
 *
 * Supported: type (string/number/integer/boolean/object/array/null), object
 * properties + required, arrays + items, enum, const, default, anyOf/oneOf/allOf,
 * local `$ref` (#/$defs, #/definitions), additionalProperties (object). Anything
 * else (patternProperties, if/then/else, not, dependentSchemas, $ref to other
 * documents, …) is recorded in `unsupported`.
 */

export type JsonSchema = Record<string, any>;

export interface SchemaGenResult {
  /** A schema-valid instance. */
  valid: unknown;
  /** Boundary-invalid instances, each with the reason it should be rejected. */
  invalid: Array<{ input: unknown; reason: string }>;
  /** Schema constructs encountered that this generator does not model. */
  unsupported: string[];
}

const UNSUPPORTED_KEYWORDS = [
  'patternProperties',
  'if',
  'then',
  'else',
  'not',
  'dependentSchemas',
  'dependencies',
  'propertyNames',
  'unevaluatedProperties',
];

/** Generate valid + boundary-invalid inputs for a schema. */
export function generateInputs(schema: JsonSchema | undefined, root?: JsonSchema): SchemaGenResult {
  const ctx: GenContext = { root: root ?? schema ?? {}, unsupported: new Set() };
  const valid = genValid(schema ?? {}, ctx);
  const invalid = genInvalid(schema ?? {}, ctx);
  return { valid, invalid, unsupported: Array.from(ctx.unsupported).sort() };
}

interface GenContext {
  root: JsonSchema;
  unsupported: Set<string>;
}

function resolveRef(schema: JsonSchema, ctx: GenContext): JsonSchema {
  const ref = schema.$ref;
  if (typeof ref !== 'string') return schema;
  // Only local refs of the form #/$defs/Name or #/definitions/Name.
  const m = ref.match(/^#\/(\$defs|definitions)\/(.+)$/);
  if (!m) {
    ctx.unsupported.add(`$ref:${ref}`);
    return {};
  }
  const target = (ctx.root[m[1]] ?? {})[m[2]];
  if (!target) {
    ctx.unsupported.add(`$ref:${ref}`);
    return {};
  }
  return target;
}

function note(schema: JsonSchema, ctx: GenContext): void {
  for (const kw of UNSUPPORTED_KEYWORDS) {
    if (kw in schema) ctx.unsupported.add(kw);
  }
}

function genValid(schemaIn: JsonSchema, ctx: GenContext): unknown {
  const schema = schemaIn.$ref ? resolveRef(schemaIn, ctx) : schemaIn;
  note(schema, ctx);

  if ('default' in schema) return schema.default;
  if ('const' in schema) return schema.const;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  for (const key of ['allOf', 'anyOf', 'oneOf'] as const) {
    if (Array.isArray(schema[key]) && schema[key].length) {
      // Pick the first branch (allOf: first member — shallow, sufficient for inputs).
      return genValid(schema[key][0], ctx);
    }
  }

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'string': return typeof schema.minLength === 'number' ? 'x'.repeat(Math.max(1, schema.minLength)) : 'x';
    case 'integer':
    case 'number': return typeof schema.minimum === 'number' ? schema.minimum : 0;
    case 'boolean': return true;
    case 'null': return null;
    case 'array': {
      const items = schema.items ? genValid(schema.items, ctx) : 'x';
      const min = typeof schema.minItems === 'number' ? schema.minItems : 1;
      return Array.from({ length: Math.max(1, min) }, () => items);
    }
    case 'object':
    default: {
      const out: Record<string, unknown> = {};
      const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
      const required: string[] = Array.isArray(schema.required) ? schema.required : [];
      // include all required props; for objects with no required, include all declared props
      const keys = required.length ? required : Object.keys(props);
      for (const k of keys) {
        if (props[k]) out[k] = genValid(props[k], ctx);
        else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          out[k] = genValid(schema.additionalProperties, ctx);
        } else {
          out[k] = 'x';
        }
      }
      return out;
    }
  }
}

function genInvalid(schemaIn: JsonSchema, ctx: GenContext): Array<{ input: unknown; reason: string }> {
  const schema = schemaIn.$ref ? resolveRef(schemaIn, ctx) : schemaIn;
  const out: Array<{ input: unknown; reason: string }> = [];
  const valid = genValid(schema, ctx);

  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;

  // 1) drop a required field
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  if (type === 'object' || schema.properties) {
    if (required.length && valid && typeof valid === 'object') {
      const missing = { ...(valid as Record<string, unknown>) };
      delete missing[required[0]];
      out.push({ input: missing, reason: `missing required field: ${required[0]}` });
    }
    // 2) wrong type for a declared property
    const props = (schema.properties ?? {}) as Record<string, JsonSchema>;
    const firstProp = Object.keys(props)[0];
    if (firstProp && valid && typeof valid === 'object') {
      const wrong = { ...(valid as Record<string, unknown>) };
      wrong[firstProp] = wrongTypeFor(props[firstProp]);
      out.push({ input: wrong, reason: `wrong type for field: ${firstProp}` });
    }
  }

  // 3) enum violation
  if (Array.isArray(schema.enum) && schema.enum.length) {
    out.push({ input: '__not_in_enum__', reason: 'value not in enum' });
  }

  // 4) primitive type violation at the root
  if (type && type !== 'object' && type !== 'array') {
    out.push({ input: wrongTypeFor(schema), reason: `root expected ${type}` });
  }

  return out;
}

function wrongTypeFor(schema: JsonSchema): unknown {
  const type = Array.isArray(schema.type) ? schema.type[0] : schema.type;
  switch (type) {
    case 'string': return 12345; // number where string expected
    case 'number':
    case 'integer': return 'not-a-number';
    case 'boolean': return 'not-a-bool';
    case 'array': return 'not-an-array';
    case 'object': return 'not-an-object';
    default: return null;
  }
}
