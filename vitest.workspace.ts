export default [
  {
    test: {
      name: 'unit',
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
    }
  },
  {
    test: {
      name: 'integration',
      environment: 'node',
      include: ['tests/integration/**/*.test.ts'],
      hookTimeout: 120000,
      testTimeout: 120000,
    }
  },
  {
    test: {
      name: 'security',
      environment: 'node',
      include: ['tests/security/**/*.test.ts'],
      hookTimeout: 120000,
      testTimeout: 120000,
    }
  },
  {
    test: {
      name: 'concurrency',
      environment: 'node',
      include: ['tests/concurrency/**/*.test.ts'],
      hookTimeout: 120000,
      testTimeout: 120000,
    }
  },
  {
    test: {
      name: 'regression',
      environment: 'node',
      include: ['tests/regression/**/*.test.ts'],
      hookTimeout: 120000,
      testTimeout: 120000,
    }
  }
];
