import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
  coverageDirectory: 'coverage',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      { tsconfig: { rootDir: '.' } },
    ],
  },
  // Several Solana/Orca packages ship ESM. Transform them through ts-jest
  // instead of leaving them as-is (which Jest CJS mode can't parse).
  transformIgnorePatterns: [
    'node_modules/(?!(' + [
      'rpc-websockets',
      '@solana/web3\\.js',
      '@solana/spl-token',
      '@orca-so/whirlpools-sdk',
      '@orca-so/common-sdk',
      '@coral-xyz/anchor',
      'superstruct',
      'uuid',
    ].join('|') + '))',
  ],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
};

export default config;
