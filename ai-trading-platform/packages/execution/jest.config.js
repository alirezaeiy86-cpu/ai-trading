/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    '^@trading/types(.*)$':       '<rootDir>/../../packages/types/src$1',
    '^@trading/risk-engine(.*)$': '<rootDir>/../../packages/risk-engine/src$1',
    '^@trading/database(.*)$':    '<rootDir>/../../packages/database/src$1',
    '^@trading/logger(.*)$':      '<rootDir>/../../packages/logger/src$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
};
