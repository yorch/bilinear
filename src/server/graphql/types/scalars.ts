import { GraphQLScalarType, Kind } from 'graphql';

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

export const JSONScalar = new GraphQLScalarType({
  description: 'Arbitrary JSON value.',
  name: 'JSON',
  parseLiteral(ast): unknown {
    if (ast.kind === Kind.STRING) {
      return JSON.parse(ast.value);
    }
    if (ast.kind === Kind.INT || ast.kind === Kind.FLOAT) {
      return Number(ast.value);
    }
    if (ast.kind === Kind.BOOLEAN) {
      return ast.value;
    }
    if (ast.kind === Kind.NULL) {
      return null;
    }
    if (ast.kind === Kind.LIST) {
      return ast.values.map((v: unknown) =>
        JSONScalar.parseLiteral(
          v as Parameters<typeof JSONScalar.parseLiteral>[0],
          {},
        ),
      );
    }
    if (ast.kind === Kind.OBJECT) {
      const obj: Record<string, unknown> = {};
      for (const field of ast.fields) {
        obj[field.name.value] = JSONScalar.parseLiteral(field.value, {});
      }
      return obj;
    }
    throw new Error('JSON scalar: unexpected AST kind');
  },
  parseValue(value: unknown): unknown {
    return value;
  },
  serialize(value: unknown): unknown {
    return value;
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
