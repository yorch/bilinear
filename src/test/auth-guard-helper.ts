/**
 * Shared assertion for the §5.5 resolver auth-guard sweep.
 *
 * Two things get exercised with the exact same shape:
 *  - an auth/authorization guard (`requireAuth`/`requireOrgRole`/
 *    `requireTeamMember`/etc.) rejecting an unauthenticated or
 *    insufficiently-privileged caller with the documented
 *    `extensions.code` (UNAUTHENTICATED / FORBIDDEN), and
 *  - a resolver's `catch` block remapping a service's typed error (e.g.
 *    `NotFoundError`, `*ValidationError`) to its documented
 *    `extensions.code` (NOT_FOUND / BAD_USER_INPUT / FORBIDDEN / ...).
 *
 * Callers build the failure condition themselves — pass an unauthenticated
 * `ctx` (e.g. `createMockContext({ userId: null })`), or `vi.spyOn` a
 * service method to `mockRejectedValue(new SomeTypedError())` — then hand
 * the resolver, its args, and the prepared ctx to this helper, which just
 * asserts the resulting rejection is a `GraphQLError` with the expected
 * `extensions.code`. Nothing here invents behavior; it only checks what the
 * resolver actually throws.
 */
import { GraphQLError } from 'graphql';
import { expect } from 'vitest';

// biome-ignore lint/suspicious/noExplicitAny: resolver signatures vary per field/mutation
type Resolver = (parent: any, args: any, ctx: any) => unknown;

export async function testAuthGuard(
  resolver: Resolver,
  args: unknown,
  ctx: unknown,
  expectedCode: string,
): Promise<void> {
  let caught: unknown;
  try {
    await resolver(null, args, ctx);
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected the resolver to throw').toBeInstanceOf(GraphQLError);
  expect((caught as GraphQLError).extensions?.code).toBe(expectedCode);
}
