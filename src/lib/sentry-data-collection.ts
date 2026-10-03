import type { init } from '@sentry/nextjs';

/**
 * Derived from `Sentry.init`'s own parameter rather than imported as a named
 * type: `DataCollection` is re-exported from `@sentry/core`, which is a
 * transitive dependency here, and naming it directly would mean depending on a
 * package this app never declares.
 */
type DataCollection = NonNullable<NonNullable<Parameters<typeof init>[0]>['dataCollection']>;

/**
 * What the Sentry SDK is allowed to collect, stated explicitly for all three
 * `Sentry.init` sites (server, edge, browser).
 *
 * This exists because the default inverted in SDK v11. Under v10 the knob was
 * `sendDefaultPii`, and leaving it unset — which this app always did — was the
 * restrictive choice: no cookies, no request bodies, no headers. v11 renamed it
 * to `dataCollection` and made an *unset* value mean "collect everything", so
 * the upgrade would have silently started shipping cookies, request and
 * response bodies, GraphQL documents and variables, bound database query
 * parameters and local stack-frame variables to Sentry.
 *
 * For this app that is not a theoretical concern. Magic-link codes travel in
 * `/verify` query params, SAML assertions and SCIM tokens arrive in request
 * bodies, session JWTs live in cookies and `Authorization` headers, and every
 * mutation's GraphQL variables carry whatever the user typed. Issue and comment
 * bodies in private teams are the product's own confidential data.
 *
 * So the posture is deny-by-default and each field is named rather than
 * inherited: a future SDK adding a new collection category defaults it to on,
 * and only an explicit list makes that visible as a diff here instead of as a
 * change in what leaves the process. Loosen individual fields deliberately if
 * a debugging need justifies it.
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
  cookies: false,
  databaseQueryData: false,
  genAI: { inputs: false, outputs: false },
  graphQL: { document: false, variables: false },
  httpBodies: [],
  httpHeaders: false,
  queues: false,
  stackFrameVariables: false,
  urlQueryParams: false,
  userInfo: false,
};
