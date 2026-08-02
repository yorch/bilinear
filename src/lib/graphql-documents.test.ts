import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  buildSchema,
  type GraphQLSchema,
  getNamedType,
  isInputObjectType,
  isObjectType,
  parse,
  validate,
} from 'graphql';
import { describe, expect, it } from 'vitest';
import { typeDefs } from '@/server/graphql/schema';

/**
 * Every GraphQL document the client sends is a plain template literal handed to
 * `gql()` — there is no Apollo Client, no codegen, and no build step that would
 * catch a document drifting out of sync with the server schema. Nothing failed
 * until a user hit the request at runtime.
 *
 * This suite closes that gap: it scans the source tree for embedded documents
 * and validates each one against the real `typeDefs`, so schema/document drift
 * (an unknown field, a wrong argument type, a union selection whose sibling
 * fragments disagree on nullability) fails in CI instead of in the browser.
 */

const REPO_ROOT = resolve(__dirname, '..', '..');
// `src/` is the bulk of it, but Playwright specs under `tests/` issue GraphQL
// too — and a document that only lives there is exactly the one that drifts
// unnoticed, because no unit test exercises it.
const SCAN_DIRS = ['src', 'tests'].map(d => join(REPO_ROOT, d));
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];
const SKIP_DIRS = new Set(['generated', 'node_modules']);

/** A template literal whose body looks like a GraphQL operation. */
interface FoundDocument {
  body: string;
  file: string;
  /** 1-indexed line of the opening backtick, for a navigable failure message. */
  line: number;
}

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return SKIP_DIRS.has(entry) ? [] : listSourceFiles(full);
    }
    if (!SOURCE_EXTENSIONS.some(ext => entry.endsWith(ext)) || entry.includes('.test.')) {
      return [];
    }
    return [full];
  });
}

/**
 * Split a source file into its backtick-delimited template literals. GraphQL
 * documents never contain a backtick themselves, so scanning backtick-to-backtick
 * (respecting backslash escapes) is sufficient here — this is not a general JS
 * lexer, and it does not need to be.
 */
function extractTemplateLiterals(source: string): { body: string; index: number }[] {
  const literals: { body: string; index: number }[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '`') {
      continue;
    }
    const start = i;
    i++;
    while (i < source.length && source[i] !== '`') {
      i += source[i] === '\\' ? 2 : 1;
    }
    literals.push({ body: source.slice(start + 1, i), index: start });
  }
  return literals;
}

/** `query Foo {`, `mutation Foo {`, or an anonymous `query {` / `mutation {`. */
const OPERATION_START = /^\s*(query|mutation)\s*[A-Za-z_]*\s*[({]/;

/**
 * Documents compose shared field lists by interpolating a sibling `const` (e.g.
 * `issue { ${ISSUE_FIELDS} }`). Inline those from the same file so the document
 * can be parsed. Bounded so a self-referential const can't spin.
 */
function inlineFragmentConstants(body: string, constants: Map<string, string>): string {
  let out = body;
  for (let pass = 0; pass < 5 && out.includes('${'); pass++) {
    out = out.replace(
      /\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g,
      (match, name: string) => constants.get(name) ?? match,
    );
  }
  return out;
}

function collectDocuments(): FoundDocument[] {
  const documents: FoundDocument[] = [];

  for (const file of SCAN_DIRS.flatMap(listSourceFiles)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes('`')) {
      continue;
    }
    const literals = extractTemplateLiterals(source);

    // `const NAME = ` immediately preceding a literal makes it addressable as an
    // interpolation target from another literal in the same file. Shared field
    // lists are written both as template literals and as plain quoted strings,
    // so collect both.
    const constants = new Map<string, string>();
    for (const literal of literals) {
      const assignment = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*$/.exec(
        source.slice(0, literal.index),
      );
      if (assignment) {
        constants.set(assignment[1], literal.body);
      }
    }
    for (const match of source.matchAll(
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(['"])((?:[^\\]|\\.)*?)\2/g,
    )) {
      constants.set(match[1], match[3]);
    }

    for (const literal of literals) {
      if (!OPERATION_START.test(literal.body)) {
        continue;
      }
      documents.push({
        body: inlineFragmentConstants(literal.body, constants),
        file: relative(REPO_ROOT, file),
        line: source.slice(0, literal.index).split('\n').length,
      });
    }
  }

  return documents;
}

describe('client GraphQL documents', () => {
  const schema: GraphQLSchema = buildSchema(typeDefs);
  const documents = collectDocuments();

  it('finds the documents embedded in the source tree', () => {
    // A guard on the scanner itself: if a refactor moves documents somewhere the
    // regex no longer matches, this suite would silently validate nothing.
    expect(documents.length).toBeGreaterThan(50);
    expect(documents.map(d => d.file)).toContain('src/lib/graphql-queries.ts');
  });

  it('leaves no interpolation unresolved', () => {
    // An unresolved `${...}` would make the document unparseable and get reported
    // as a syntax error below, which would be a confusing way to learn that the
    // scanner simply could not find the constant.
    const unresolved = documents.filter(d => d.body.includes('${'));
    expect(unresolved.map(d => `${d.file}:${d.line}`)).toEqual([]);
  });

  it.each(collectDocuments().map(d => [`${d.file}:${d.line}`, d] as const))(
    'validates against the server schema: %s',
    (_label, document) => {
      const errors = validate(schema, parse(document.body));
      expect(errors.map(e => e.message)).toEqual([]);
    },
  );
});

/**
 * Entity-reference arguments and input fields must be `ID`, never `String` —
 * see PATTERNS.md §77.1. GraphQL compares a variable's *declared* type against
 * the argument type, so a `teamId` spelled `String!` on one field and `ID!` on
 * its sibling makes `$teamId: String!` a coin flip that rejects the whole
 * request.
 *
 * The document validation above cannot catch this: a new field declared
 * `teamId: String!` with a document that also says `String!` validates
 * perfectly. This is the schema↔convention check, not the document↔schema one.
 */
describe('SDL entity-reference scalars', () => {
  const schema = buildSchema(typeDefs);

  /** Not entity references, despite the name shape. */
  const EXEMPT = new Set([
    'lastSyncId', // opaque BIGSERIAL delta cursor
    'slugId', // human-readable project slug
    'idpEntityId', // SAML entity URI
  ]);

  const isReferenceName = (name: string) => /^id$|Id$|Ids$/.test(name) && !EXEMPT.has(name);

  const offenders: string[] = [];
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith('__')) {
      continue;
    }
    if (isInputObjectType(type)) {
      for (const field of Object.values(type.getFields())) {
        if (isReferenceName(field.name) && getNamedType(field.type).name === 'String') {
          offenders.push(`input ${type.name}.${field.name}`);
        }
      }
    } else if (isObjectType(type)) {
      for (const field of Object.values(type.getFields())) {
        for (const arg of field.args) {
          if (isReferenceName(arg.name) && getNamedType(arg.type).name === 'String') {
            offenders.push(`${type.name}.${field.name}(${arg.name}:)`);
          }
        }
      }
    }
  }

  it('types every entity-reference argument and input field as ID', () => {
    expect(offenders).toEqual([]);
  });
});
