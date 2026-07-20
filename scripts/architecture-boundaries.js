import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const INTERNAL_PREFIX = "@beat-twin/";
const IGNORED_DIRECTORIES = new Set([".git", "dist", "node_modules"]);
const RUNTIME_EXTENSIONS = new Set([".cjs", ".js", ".jsx", ".mjs", ".ts", ".tsx"]);

export function validateArchitecture(rootDir, policy = readPolicy(rootDir)) {
  validatePolicy(policy);
  const workspaces = discoverWorkspaces(rootDir, policy);
  const byName = new Map(workspaces.map((workspace) => [workspace.name, workspace]));
  const errors = [];
  const edges = [];

  for (const workspace of workspaces) {
    for (const dependency of runtimeDependencies(workspace.manifest)) {
      if (!dependency.startsWith(INTERNAL_PREFIX)) continue;
      const target = byName.get(dependency);
      if (!target) {
        errors.push(`${workspace.name} declares unknown internal dependency ${dependency}`);
        continue;
      }
      edges.push({ from: workspace.name, to: target.name });
      validateEdge(workspace, target, policy, errors);
    }
    validateRuntimeImports(rootDir, workspace, byName, errors);
  }

  validateExceptions(policy, edges, workspaces, errors);
  const cycle = findCycle(workspaces.map(({ name }) => name), edges);
  if (cycle) errors.push(`runtime dependency cycle: ${cycle.join(" -> ")}`);

  return Object.freeze({
    errors: Object.freeze([...new Set(errors)].sort()),
    workspaces: Object.freeze(workspaces.map(({ name, path, layer }) => ({ name, path, layer }))),
    edges: Object.freeze(edges),
  });
}

export function formatArchitectureResult(result) {
  if (result.errors.length === 0) {
    return `architecture boundaries: ${result.workspaces.length} workspaces, ${result.edges.length} internal runtime edges, no violations`;
  }
  return [
    `architecture boundaries: ${result.errors.length} violation(s)`,
    ...result.errors.map((error) => `- ${error}`),
  ].join("\n");
}

function readPolicy(rootDir) {
  return JSON.parse(readFileSync(resolve(rootDir, "architecture-policy.json"), "utf8"));
}

function validatePolicy(policy) {
  if (policy?.schemaVersion !== 1 || !Array.isArray(policy.layers)) {
    throw new Error("architecture policy must use schemaVersion 1 and define layers");
  }
  const layerNames = new Set();
  for (const layer of policy.layers) {
    if (typeof layer?.name !== "string" || !Array.isArray(layer.paths) || layer.paths.length === 0) {
      throw new Error("every architecture layer must have a name and at least one path");
    }
    if (layerNames.has(layer.name)) throw new Error(`duplicate architecture layer ${layer.name}`);
    layerNames.add(layer.name);
  }
  for (const rule of policy.protectedLayerRules ?? []) {
    if (!layerNames.has(rule.from) || !Array.isArray(rule.forbid)) {
      throw new Error("protected layer rules must reference known layers");
    }
    for (const target of rule.forbid) {
      if (!layerNames.has(target)) throw new Error(`unknown forbidden layer ${target}`);
    }
  }
  for (const exception of policy.exceptions ?? []) {
    if (
      exception?.kind !== "package-to-app" ||
      !isInternalName(exception.from) ||
      !isInternalName(exception.to) ||
      typeof exception.trackingIssue !== "string" ||
      !/^#\d+$/.test(exception.trackingIssue) ||
      typeof exception.reason !== "string" ||
      exception.reason.trim().length === 0
    ) {
      throw new Error("architecture exceptions must be exact, documented package-to-app edges with a tracking issue");
    }
  }
}

function discoverWorkspaces(rootDir, policy) {
  const manifests = [];
  walk(rootDir, (path) => {
    if (path.endsWith(`${sep}package.json`) || path === resolve(rootDir, "package.json")) {
      manifests.push(path);
    }
  });
  return manifests.map((manifestPath) => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof manifest.name !== "string" || manifest.name.length === 0) {
      throw new Error(`${relative(rootDir, manifestPath)} has no package name`);
    }
    const directory = dirname(manifestPath);
    const path = toPosix(relative(rootDir, directory) || ".");
    const matchingLayers = policy.layers.filter((layer) =>
      layer.paths.some((pattern) => matchesPath(path, pattern))
    );
    if (matchingLayers.length !== 1) {
      throw new Error(`${manifest.name} at ${path} must match exactly one architecture layer`);
    }
    return Object.freeze({ name: manifest.name, path, directory, manifest, layer: matchingLayers[0].name });
  }).sort((left, right) => left.name.localeCompare(right.name));
}

function walk(directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) walk(path, visit);
    else if (entry.isFile()) visit(path);
  }
}

function matchesPath(path, pattern) {
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1);
    return path.startsWith(prefix) && !path.slice(prefix.length).includes("/");
  }
  return path === pattern;
}

function runtimeDependencies(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

function validateEdge(source, target, policy, errors) {
  if (source.path.startsWith("packages/") && target.layer === "app") {
    const allowed = (policy.exceptions ?? []).some((exception) =>
      exception.kind === "package-to-app" && exception.from === source.name && exception.to === target.name
    );
    if (!allowed) errors.push(`${source.name} (${source.path}) must not depend on app ${target.name} (${target.path})`);
  }
  for (const rule of policy.protectedLayerRules ?? []) {
    if (source.layer === rule.from && rule.forbid.includes(target.layer)) {
      errors.push(`${source.name} in protected layer ${source.layer} must not depend on ${target.name} in ${target.layer}`);
    }
  }
}

function validateRuntimeImports(rootDir, workspace, byName, errors) {
  const declared = runtimeDependencies(workspace.manifest);
  for (const file of runtimeFiles(workspace)) {
    const source = readFileSync(file, "utf8");
    for (const specifier of importSpecifiers(source)) {
      if (specifier.startsWith(".")) {
        const targetPath = resolve(dirname(file), specifier);
        const targetWorkspace = workspaceForPath(targetPath, [...byName.values()]);
        if (targetWorkspace && targetWorkspace.name !== workspace.name) {
          errors.push(`${workspace.name} imports ${toPosix(relative(rootDir, targetPath))} across a workspace boundary; use ${targetWorkspace.name}'s public export`);
        }
        continue;
      }
      const internalName = internalPackageName(specifier);
      if (!internalName || internalName === workspace.name) continue;
      if (!byName.has(internalName)) {
        errors.push(`${workspace.name} imports unknown internal package ${internalName} in ${toPosix(relative(rootDir, file))}`);
      } else if (!declared.has(internalName)) {
        errors.push(`${workspace.name} imports undeclared runtime dependency ${internalName} in ${toPosix(relative(rootDir, file))}`);
      }
    }
  }
}

function runtimeFiles(workspace) {
  const files = new Set();
  const src = resolve(workspace.directory, "src");
  if (existsSync(src) && statSync(src).isDirectory()) {
    walk(src, (path) => {
      if (!path.endsWith(".d.ts") && RUNTIME_EXTENSIONS.has(extname(path))) files.add(path);
    });
  }
  const entries = [workspace.manifest.main, workspace.manifest.module];
  const bins = workspace.manifest.bin;
  if (typeof bins === "string") entries.push(bins);
  else if (bins && typeof bins === "object") entries.push(...Object.values(bins));
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const path = resolve(workspace.directory, entry);
    if (existsSync(path) && statSync(path).isFile() && !path.endsWith(".d.ts")) files.add(path);
  }
  return [...files].sort();
}

function importSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^;"']*?\s+from\s+)?["']([^"']+)["']/g,
    /\bexport\s+(?:type\s+)?(?:\*|\{[\s\S]*?\})\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return specifiers;
}

function internalPackageName(specifier) {
  if (!specifier.startsWith(INTERNAL_PREFIX)) return null;
  return specifier.split("/").slice(0, 2).join("/");
}

function workspaceForPath(path, workspaces) {
  return workspaces
    .filter((workspace) => path === workspace.directory || path.startsWith(`${workspace.directory}${sep}`))
    .sort((left, right) => right.directory.length - left.directory.length)[0] ?? null;
}

function validateExceptions(policy, edges, workspaces, errors) {
  const workspaceNames = new Set(workspaces.map(({ name }) => name));
  const edgeKeys = new Set(edges.map(({ from, to }) => `${from}\0${to}`));
  const exceptionKeys = new Set();
  for (const exception of policy.exceptions ?? []) {
    const key = `${exception.from}\0${exception.to}`;
    if (exceptionKeys.has(key)) errors.push(`duplicate architecture exception ${exception.from} -> ${exception.to}`);
    exceptionKeys.add(key);
    if (!workspaceNames.has(exception.from) || !workspaceNames.has(exception.to)) {
      errors.push(`architecture exception references unknown workspace ${exception.from} -> ${exception.to}`);
    } else if (!edgeKeys.has(key)) {
      errors.push(`stale architecture exception ${exception.from} -> ${exception.to}; remove it`);
    }
  }
}

function findCycle(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) adjacency.get(edge.from)?.push(edge.to);
  const state = new Map();
  const stack = [];
  function visit(node) {
    state.set(node, "visiting");
    stack.push(node);
    for (const target of adjacency.get(node) ?? []) {
      if (state.get(target) === "visiting") {
        const start = stack.indexOf(target);
        return [...stack.slice(start), target];
      }
      if (state.get(target) !== "visited") {
        const cycle = visit(target);
        if (cycle) return cycle;
      }
    }
    stack.pop();
    state.set(node, "visited");
    return null;
  }
  for (const node of nodes) {
    if (!state.has(node)) {
      const cycle = visit(node);
      if (cycle) return cycle;
    }
  }
  return null;
}

function isInternalName(value) {
  return typeof value === "string" && value.startsWith(INTERNAL_PREFIX) && value.length > INTERNAL_PREFIX.length;
}

function toPosix(path) {
  return path.split(sep).join("/");
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const rootDir = resolve(dirname(scriptPath), "..");
  const result = validateArchitecture(rootDir);
  console.log(formatArchitectureResult(result));
  if (result.errors.length > 0) process.exitCode = 1;
}
