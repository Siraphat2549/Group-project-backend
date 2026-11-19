import { prismaLogLevels } from './prisma.service';

describe('prismaLogLevels', () => {
  it.each(['production', 'development', undefined])(
    'logs Prisma errors when NODE_ENV=%s',
    (nodeEnv) => {
      expect(prismaLogLevels(nodeEnv)).toEqual(['warn', 'error']);
    },
  );

  it('keeps tests quiet: expected errors (e.g. duplicate email -> 409) are not printed', () => {
    expect(prismaLogLevels('test')).toEqual(['warn']);
  });

  it('never logs queries (they can contain user data)', () => {
    for (const env of ['production', 'development', 'test']) {
      expect(prismaLogLevels(env)).not.toContain('query');
    }
  });
});
