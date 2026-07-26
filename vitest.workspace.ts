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
    }
  },
  {
    test: {
      name: 'security',
      environment: 'node',
      include: ['tests/security/**/*.test.ts'],
    }
  },
  {
    test: {
      name: 'concurrency',
      environment: 'node',
      include: ['tests/concurrency/**/*.test.ts'],
    }
  },
  {
    test: {
      name: 'regression',
      environment: 'node',
      include: ['tests/regression/**/*.test.ts'],
    }
  }
];
