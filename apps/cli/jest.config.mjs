/**
 * Jest 30 + ESM setup.
 * We compile TS with tsc first, then run Jest on built JS for fast, deterministic tests.
 */
export default {
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: ["src/**/*.ts", "!src/**/*.test.ts"],
  coverageProvider: "v8",
  injectGlobals: false,
  roots: ["<rootDir>/tests"],
  testEnvironment: "node",
  testMatch: ["**/*.test.js"],
};
