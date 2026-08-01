import { makeExecutableSchema } from '@graphql-tools/schema';
import { describe, expect, it } from 'vitest';
import { resolvers } from './resolvers';
import { typeDefs } from './schema';

/**
 * Builds the real executable schema the way `/api/graphql` does.
 *
 * Until this existed, an SDL syntax error, a field pointing at a type that
 * was renamed or deleted, or a resolver map keyed to a type the SDL doesn't
 * declare would all pass `yarn typecheck`, `yarn test`, and `yarn build` —
 * `typeDefs` is just a template literal and nothing parsed it — and surface
 * only when a server booted. That is a whole-API outage from a class of
 * mistake a two-line test catches.
 */
describe('GraphQL schema', () => {
  const schema = makeExecutableSchema({
    resolvers,
    typeDefs,
  });

  it('parses and every referenced type resolves', () => {
    // makeExecutableSchema throws on unparseable SDL or an unknown type
    // reference, so reaching here is most of the assertion.
    expect(schema.getQueryType()).toBeDefined();
    expect(schema.getMutationType()).toBeDefined();
  });

  it('has no resolvers for types or fields the SDL does not declare', () => {
    // Catches a resolver left behind after its schema field was renamed or
    // removed — dead code that reads as live. Checked by hand rather than
    // via makeExecutableSchema's `requireResolversToMatchSchema`, which this
    // version of @graphql-tools/schema does not accept.
    const orphans: string[] = [];
    for (const [typeName, fieldMap] of Object.entries(resolvers)) {
      const type = schema.getType(typeName);
      if (!type) {
        orphans.push(typeName);
        continue;
      }
      if (!('getFields' in type) || typeof fieldMap !== 'object' || fieldMap === null) {
        continue;
      }
      const declared = type.getFields() as Record<string, unknown>;
      for (const fieldName of Object.keys(fieldMap)) {
        // Scalars and union/interface resolvers carry `__`-prefixed and
        // config keys that are not fields.
        if (fieldName.startsWith('__')) {
          continue;
        }
        if (!(fieldName in declared)) {
          orphans.push(`${typeName}.${fieldName}`);
        }
      }
    }
    expect(orphans).toEqual([]);
  });

  it('exposes the membership-management surface', () => {
    const mutation = schema.getMutationType();
    const query = schema.getQueryType();
    const mutationFields = mutation ? Object.keys(mutation.getFields()) : [];
    const queryFields = query ? Object.keys(query.getFields()) : [];

    expect(mutationFields).toEqual(
      expect.arrayContaining([
        'organizationInviteAccept',
        'organizationInviteCreate',
        'organizationInviteRevoke',
        'organizationMemberRemove',
        'organizationSwitch',
      ]),
    );
    expect(queryFields).toEqual(
      expect.arrayContaining(['organizationInvites', 'viewerOrganizations']),
    );
  });

  it('returns one shared payload from every enter-an-organization mutation', () => {
    // These three drifted apart as separate types once already; pinning them
    // to one type is the point of EnterOrganizationPayload.
    const fields = schema.getMutationType()?.getFields();
    const names = ['organizationCreate', 'organizationSwitch', 'organizationInviteAccept'].map(f =>
      String(fields?.[f]?.type),
    );
    expect(names).toEqual([
      'EnterOrganizationPayload!',
      'EnterOrganizationPayload!',
      'EnterOrganizationPayload!',
    ]);
  });
});

describe('resolver coverage', () => {
  const schema = makeExecutableSchema({ resolvers, typeDefs });

  it('every Query and Mutation field has a resolver', () => {
    // The orphan check above catches a resolver with no schema field. This is
    // the other direction: a field declared in the SDL but never wired into
    // `resolvers/index.ts` falls back to default resolution, which returns
    // `undefined` — a non-null field then nulls the whole response at
    // runtime, and nothing before this would have said so.
    const missing: string[] = [];
    for (const rootName of ['Query', 'Mutation'] as const) {
      const rootType = schema.getType(rootName);
      const wired = (resolvers as Record<string, Record<string, unknown>>)[rootName] ?? {};
      if (!rootType || !('getFields' in rootType)) {
        continue;
      }
      for (const fieldName of Object.keys(rootType.getFields())) {
        if (!(fieldName in wired)) {
          missing.push(`${rootName}.${fieldName}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
