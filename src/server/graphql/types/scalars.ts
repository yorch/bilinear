import { GraphQLError, GraphQLScalarType, Kind } from 'graphql';
import { GraphQLJSON } from 'graphql-scalars';

export const JSONScalar = GraphQLJSON;

/**
 * `new Date(x)` never throws — an unparseable string silently becomes an
 * Invalid Date whose `getTime()` is NaN. Left unchecked, that Invalid Date
 * flows straight into resolver/service logic (e.g. comparisons like `endsAt
 * <= startsAt` on a Cycle) with no signal that the input was garbage.
 * Centralised here so both parseValue and parseLiteral reject it at the
 * scalar boundary instead of every call site re-deriving the check.
 */
function parseDateTimeInput(raw: string): Date {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new GraphQLError(`DateTime scalar: invalid date-time value "${raw}"`, {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  }
  return date;
}

export const DateTimeScalar = new GraphQLScalarType({
  description: 'An ISO-8601 encoded UTC date-time string.',
  name: 'DateTime',
  parseLiteral(ast): Date {
    if (ast.kind === Kind.STRING) {
      return parseDateTimeInput(ast.value);
    }
    throw new GraphQLError('DateTime scalar: expected a string literal', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  },
  parseValue(value: unknown): Date {
    if (typeof value === 'string') {
      return parseDateTimeInput(value);
    }
    throw new GraphQLError('DateTime scalar: expected a string', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  },
  serialize(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (typeof value === 'string') {
      return new Date(value).toISOString();
    }
    throw new Error('DateTime scalar: unsupported value');
  },
});

export const UUIDScalar = new GraphQLScalarType({
  description: 'A field whose value is a valid UUID.',
  name: 'UUID',
  parseLiteral(ast): string {
    if (ast.kind === Kind.STRING) {
      return ast.value;
    }
    throw new Error('UUID scalar: expected a string literal');
  },
  parseValue(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    throw new Error('UUID scalar: expected a string');
  },
  serialize(value: unknown): string {
    if (typeof value === 'string') {
      return value;
    }
    throw new Error('UUID scalar: expected a string');
  },
});
