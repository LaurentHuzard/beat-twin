import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { validateArchitecture } from "../scripts/architecture-boundaries.js";

const BASE_POLICY = Object.freeze({
  schemaVersion: 1,
  layers: [
    { name: "app", paths: [".", "apps/*"] },
    { name: "domain", paths: ["packages/domain"] },
    { name: "adapter", paths: ["packages/adapters/*"] },
    { name: "delivery", paths: ["packages/delivery"] },
  ],
  protectedLayerRules: [{ from: "domain", forbid: ["app", "adapter", "delivery"] }],
  exceptions: [],
});

test("app-to-package dependencies and declared imports pass", () => {
  withFixture([
    workspace(".", "fixture-root"),
    workspace("apps/operator", "@beat-twin/operator", ["@beat-twin/domain"], "import '@beat-twin/domain';"),
    workspace("packages/domain", "@beat-twin/domain"),
  ], (root) => {
    assert.deepEqual(validateArchitecture(root, BASE_POLICY).errors, []);
  });
});

test("package-to-app dependencies fail unless the exact edge is documented", () => {
  const entries = [
    workspace(".", "fixture-root"),
    workspace("apps/operator", "@beat-twin/operator"),
    workspace("packages/delivery", "@beat-twin/delivery", ["@beat-twin/operator"]),
    workspace("packages/domain", "@beat-twin/domain"),
  ];
  withFixture(entries, (root) => {
    const result = validateArchitecture(root, BASE_POLICY);
    assert.match(result.errors.join("\n"), /must not depend on app/);
    const exceptionPolicy = {
      ...BASE_POLICY,
      exceptions: [{
        kind: "package-to-app",
        from: "@beat-twin/delivery",
        to: "@beat-twin/operator",
        trackingIssue: "#123",
        reason: "Bounded migration edge.",
      }],
    };
    assert.deepEqual(validateArchitecture(root, exceptionPolicy).errors, []);
  });
});

test("an exception cannot expand to a second package-to-app edge", () => {
  withFixture([
    workspace(".", "fixture-root"),
    workspace("apps/operator", "@beat-twin/operator"),
    workspace("apps/second", "@beat-twin/second"),
    workspace("packages/delivery", "@beat-twin/delivery", ["@beat-twin/operator", "@beat-twin/second"]),
    workspace("packages/domain", "@beat-twin/domain"),
  ], (root) => {
    const policy = {
      ...BASE_POLICY,
      exceptions: [{
        kind: "package-to-app",
        from: "@beat-twin/delivery",
        to: "@beat-twin/operator",
        trackingIssue: "#123",
        reason: "Only this edge is allowed.",
      }],
    };
    const result = validateArchitecture(root, policy);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /@beat-twin\/second/);
  });
});

test("undeclared internal imports fail with their source path", () => {
  withFixture([
    workspace(".", "fixture-root"),
    workspace("apps/operator", "@beat-twin/operator", [], "import '@beat-twin/domain';"),
    workspace("packages/domain", "@beat-twin/domain"),
  ], (root) => {
    assert.match(
      validateArchitecture(root, BASE_POLICY).errors.join("\n"),
      /imports undeclared runtime dependency @beat-twin\/domain in apps\/operator\/src\/index.js/,
    );
  });
});

test("runtime dependency cycles report the complete cycle path", () => {
  withFixture([
    workspace(".", "fixture-root"),
    workspace("apps/operator", "@beat-twin/operator"),
    workspace("packages/domain", "@beat-twin/domain", ["@beat-twin/delivery"]),
    workspace("packages/delivery", "@beat-twin/delivery", ["@beat-twin/domain"]),
  ], (root) => {
    const policy = { ...BASE_POLICY, protectedLayerRules: [] };
    assert.match(
      validateArchitecture(root, policy).errors.join("\n"),
      /@beat-twin\/delivery -> @beat-twin\/domain -> @beat-twin\/delivery|@beat-twin\/domain -> @beat-twin\/delivery -> @beat-twin\/domain/,
    );
  });
});

test("protected domain packages cannot depend on adapters or delivery", () => {
  withFixture([
    workspace(".", "fixture-root"),
    workspace("apps/operator", "@beat-twin/operator"),
    workspace("packages/domain", "@beat-twin/domain", ["@beat-twin/adapter", "@beat-twin/delivery"]),
    workspace("packages/adapters/fixture", "@beat-twin/adapter"),
    workspace("packages/delivery", "@beat-twin/delivery"),
  ], (root) => {
    const errors = validateArchitecture(root, BASE_POLICY).errors.join("\n");
    assert.match(errors, /protected layer domain.*@beat-twin\/adapter in adapter/);
    assert.match(errors, /protected layer domain.*@beat-twin\/delivery in delivery/);
  });
});

function workspace(path, name, dependencies = [], source = "") {
  return { path, name, dependencies, source };
}

function withFixture(entries, run) {
  const root = mkdtempSync(join(tmpdir(), "beat-twin-architecture-"));
  try {
    for (const entry of entries) {
      const directory = join(root, entry.path);
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, "package.json"), JSON.stringify({
        name: entry.name,
        type: "module",
        dependencies: Object.fromEntries(entry.dependencies.map((name) => [name, "workspace:*"])),
      }));
      if (entry.source) {
        mkdirSync(join(directory, "src"), { recursive: true });
        writeFileSync(join(directory, "src/index.js"), entry.source);
      }
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
