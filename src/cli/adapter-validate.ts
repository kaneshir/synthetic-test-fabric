/**
 * `fab adapter validate <path>` — type-check a TS adapter file against its
 * target interface. Lets agents iterate on adapter wiring in seconds without
 * spinning up the full loop.
 *
 * v1 scope (this PR): method-presence detection. For each expected method
 * on the implemented interface, asserts the class declares a method with
 * that name and reports `present` | `missing`.
 *
 * Deferred to follow-up: `wrong-signature` / `wrong-return-type` detection.
 * Those require a full TypeScript program (consumer's tsconfig + resolved
 * imports) to type-check generic types like `SeededEntity[]` correctly.
 * Method-presence catches the realistic regression class — adapter author
 * forgot to implement a method — at near-zero cost.
 */

import * as fs from 'fs';
import * as ts from 'typescript';

import {
  ADAPTER_INTERFACES,
  ADAPTER_TYPES,
  isAdapterType,
  type AdapterType,
} from './init';

// ---------------------------------------------------------------------------
// Expected interface members — single source of truth
// ---------------------------------------------------------------------------

/**
 * Methods each adapter interface requires. Mirrors the exported interface
 * declarations in src/adapters.ts. v1 detects method presence; signatures
 * and return types are checked at consumer-side `tsc --noEmit` (and #26
 * integration tests).
 */
const INTERFACE_METHODS: Record<AdapterType, string[]> = {
  app:        ['seed', 'reset', 'validateEnvironment', 'verify', 'importRun'],
  simulation: ['run', 'exportEntities', 'clean'],
  scoring:    ['score'],
  feedback:   ['feedback'],
  memory:     ['migrate', 'writeEvent', 'resolveEntity', 'listEntities'],
  browser:    ['runSpecs'],
  reporter:   ['report'],
  planner:    ['plan'],
};

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ValidationError {
  method: string;
  kind: 'missing';
  expected: string;
  actual: string | null;
  line: number;
}

export interface ValidationResult {
  ok: boolean;
  type: AdapterType;
  className: string;
  errors: ValidationError[];
}

export class AdapterValidateError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'AdapterValidateError';
    this.code = code;
  }
}

export interface ValidateAdapterOptions {
  /**
   * Force interpretation as one of the 8 adapter types. When omitted, the
   * type is auto-detected from the class name suffix
   * (`*AppAdapter` → app, `*Reporter` → reporter, etc.).
   */
  type?: AdapterType;
}

// ---------------------------------------------------------------------------
// validateAdapter
// ---------------------------------------------------------------------------

/**
 * Validate that the TypeScript file at `filePath` declares a class
 * implementing one of the 8 fab adapter interfaces, with all required
 * methods present.
 *
 * Domain failure (missing methods) → `{ok: false, errors: [...]}`.
 * Infrastructure error (file missing, parse failure, no class found) → throws
 * `AdapterValidateError`.
 */
export function validateAdapter(
  filePath: string,
  opts: ValidateAdapterOptions = {},
): ValidationResult {
  if (!fs.existsSync(filePath)) {
    throw new AdapterValidateError(`file not found: ${filePath}`, 'FILE_NOT_FOUND');
  }

  const sourceText = fs.readFileSync(filePath, 'utf8');
  const source = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.ES2020, true);

  // Surface parse errors as infrastructure failure rather than silently
  // walking a partial AST. `parseDiagnostics` is populated by the parser at
  // runtime — not in the public type, so cast.
  const parseDiagnostics = (source as ts.SourceFile & { parseDiagnostics?: ts.DiagnosticWithLocation[] })
    .parseDiagnostics ?? [];
  if (parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0];
    const messageText = ts.flattenDiagnosticMessageText(first.messageText, '\n');
    const { line } = source.getLineAndCharacterOfPosition(first.start);
    throw new AdapterValidateError(
      `${filePath}: parse error at line ${line + 1}: ${messageText}`,
      'SYNTAX_ERROR',
    );
  }

  // Find the first exported class declaration in the file.
  const classDecl = findExportedClass(source);
  if (!classDecl || !classDecl.name) {
    throw new AdapterValidateError(
      `no exported class found in ${filePath}`,
      'NO_EXPORTED_CLASS',
    );
  }

  const className = classDecl.name.text;

  // Determine adapter type — explicit override, or implements clause, or
  // class-name-suffix heuristic.
  const type = resolveType(opts.type, classDecl, className);
  if (!type) {
    throw new AdapterValidateError(
      `cannot determine adapter type for class '${className}'. ` +
      `Pass --type or rename the class to end with one of: ` +
      Object.values(ADAPTER_INTERFACES).join(', '),
      'AMBIGUOUS_TYPE',
    );
  }

  // Collect declared method names on the class. Accepts both:
  //   - method-syntax form:  `async foo() { ... }`     → MethodDeclaration
  //   - class-field form:    `foo = async () => ...`   → PropertyDeclaration
  //                          `foo = function() {...}`  → PropertyDeclaration
  // Both are valid implementations of an interface method.
  const declaredMethods = new Map<string, ts.ClassElement>();
  for (const member of classDecl.members) {
    if (member.name && ts.isIdentifier(member.name)) {
      if (ts.isMethodDeclaration(member)) {
        declaredMethods.set(member.name.text, member);
      } else if (
        ts.isPropertyDeclaration(member) &&
        member.initializer &&
        (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))
      ) {
        declaredMethods.set(member.name.text, member);
      }
    }
  }

  // Compare against expected interface methods.
  const errors: ValidationError[] = [];
  const interfaceName = ADAPTER_INTERFACES[type];
  for (const expectedMethod of INTERFACE_METHODS[type]) {
    if (!declaredMethods.has(expectedMethod)) {
      errors.push({
        method: expectedMethod,
        kind: 'missing',
        expected: `${interfaceName}.${expectedMethod}`,
        actual: null,
        line: lineOfNode(source, classDecl) + 1,
      });
    }
  }

  return {
    ok: errors.length === 0,
    type,
    className,
    errors,
  };
}

// ---------------------------------------------------------------------------
// AST helpers
// ---------------------------------------------------------------------------

function findExportedClass(source: ts.SourceFile): ts.ClassDeclaration | undefined {
  for (const stmt of source.statements) {
    if (
      ts.isClassDeclaration(stmt) &&
      stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      return stmt;
    }
  }
  return undefined;
}

function resolveType(
  override: AdapterType | undefined,
  classDecl: ts.ClassDeclaration,
  className: string,
): AdapterType | null {
  if (override) return override;

  // Try implements clause: `implements AppAdapter` → 'app'
  const implementsClause = classDecl.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ImplementsKeyword);
  if (implementsClause) {
    for (const exp of implementsClause.types) {
      if (ts.isIdentifier(exp.expression)) {
        const name = exp.expression.text;
        const matched = ADAPTER_TYPES.find((t) => ADAPTER_INTERFACES[t] === name);
        if (matched) return matched;
      }
    }
  }

  // Fallback: class name suffix.
  // `*ScenarioPlanner` → planner; `*Reporter` → reporter (NOT `*Adapter`)
  // Check long suffixes first so `MyScenarioPlanner` doesn't accidentally
  // match a hypothetical "Planner" interface.
  const suffixCandidates: Array<[string, AdapterType]> = ADAPTER_TYPES
    .map((t) => [ADAPTER_INTERFACES[t], t] as [string, AdapterType])
    .sort((a, b) => b[0].length - a[0].length);
  for (const [iface, type] of suffixCandidates) {
    if (className.endsWith(iface)) return type;
  }
  return null;
}

function lineOfNode(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart()).line;
}
