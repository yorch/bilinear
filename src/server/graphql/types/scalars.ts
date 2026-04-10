import { GraphQLScalarType, Kind } from 'graphql';
import { GraphQLJSON } from 'graphql-scalars';

export const JSONScalar = GraphQLJSON;

export const DateTimeScalar = new GraphQLScalarType({
  description: 'An ISO-8601 encoded UTC date-time string.',
  name: 'DateTime',
  parseLiteral(ast): Date {
    if (ast.kind === Kind.STRING) {
      return new Date(ast.value);
    }
    throw new Error('DateTime scalar: expected a string literal');
  },
  parseValue(value: unknown): Date {
    if (typeof value === 'string') {
      return new Date(value);
    }
    throw new Error('DateTime scalar: expected a string');
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
