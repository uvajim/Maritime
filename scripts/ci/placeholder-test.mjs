#!/usr/bin/env node
// Configurable placeholder test runner.
//
// Used by packages that don't have a real test suite yet so that `npm test`
// (and therefore CI) never silently "passes with nothing run" or hard-fails
// just because tests haven't been written.
//
// Behavior:
//   - Default: print a warning and exit 0 (CI shows a visible "no tests" notice).
//   - If CI_REQUIRE_TESTS=true (or "1"): exit 1, forcing the package to add
//     real tests before CI can pass. Set this once a package is expected to
//     have coverage.
//
// Usage: node ../scripts/ci/placeholder-test.mjs <package-name>

const pkgName = process.argv[2] ?? "package";
const requireTests = ["1", "true", "yes"].includes(
  String(process.env.CI_REQUIRE_TESTS ?? "").toLowerCase()
);

const message = `[placeholder-test] ${pkgName}: no test suite configured yet.`;

if (requireTests) {
  console.error(message);
  console.error(
    "[placeholder-test] CI_REQUIRE_TESTS is set — failing because real tests are required."
  );
  process.exit(1);
}

console.warn(message);
console.warn(
  "[placeholder-test] Treating as a non-blocking placeholder (exit 0). " +
    "Set CI_REQUIRE_TESTS=true to enforce real tests for this package."
);
process.exit(0);
