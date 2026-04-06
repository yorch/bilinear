import { DateTimeScalar, UUIDScalar } from '../types/scalars';
import { authResolvers } from './auth';
import { organizationResolvers } from './organization';
import { userResolvers } from './user';

export const resolvers = {
  DateTime: DateTimeScalar,

  Mutation: {
    ...authResolvers.Mutation,
  },

  Query: {
    ...userResolvers.Query,
    ...organizationResolvers.Query,
  },

  User: {
    ...userResolvers.User,
  },
  UUID: UUIDScalar,
};
