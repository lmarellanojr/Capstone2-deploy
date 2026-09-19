/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  testMatch: ["**/src/**/*.test.ts"],
  // Matches tsconfig.json's compilerOptions.paths -- ts-jest only uses that
  // for type-checking, not runtime module resolution, so files importing
  // "@/..." need this to be requirable from a test at all.
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
}
