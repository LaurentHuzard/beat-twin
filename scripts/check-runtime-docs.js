import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function parseRuntimeContract(packageJsonText) {
  const packageJson = JSON.parse(packageJsonText);
  const nodeRange = packageJson.engines?.node;
  const packageManager = packageJson.packageManager;
  const nodeMatch = /^>=(\d+)\.(\d+)\.(\d+)$/.exec(nodeRange ?? '');
  const pnpmMatch = /^pnpm@(.+)$/.exec(packageManager ?? '');

  if (!nodeMatch) {
    throw new Error(`Unsupported engines.node contract: ${nodeRange ?? '<missing>'}`);
  }

  if (!pnpmMatch) {
    throw new Error(
      `Unsupported packageManager contract: ${packageManager ?? '<missing>'}`,
    );
  }

  return {
    nodeRange,
    nodeMajor: Number(nodeMatch[1]),
    pnpmVersion: pnpmMatch[1],
  };
}

export function validateRuntimeDocs({
  packageJsonText,
  readmeText,
  runtimeGuideText,
  ciText,
}) {
  const { nodeRange, nodeMajor, pnpmVersion } =
    parseRuntimeContract(packageJsonText);
  const errors = [];

  if (
    !readmeText.includes(`Node.js ${nodeMajor} or newer`) ||
    !readmeText.includes(`\`${nodeRange}\``)
  ) {
    errors.push(`README must document Node.js ${nodeMajor}+ and ${nodeRange}.`);
  }

  if (!readmeText.includes(`pnpm ${pnpmVersion} through Corepack`)) {
    errors.push(`README must document pnpm ${pnpmVersion} through Corepack.`);
  }

  if (!readmeText.includes('Unsupported engine')) {
    errors.push(
      'README must explain the unsupported-engine result for older Node runtimes.',
    );
  }

  if (
    !runtimeGuideText.includes(`Node.js ${nodeMajor} or newer`) ||
    !runtimeGuideText.includes(nodeRange)
  ) {
    errors.push(
      `RTX runtime guide must document Node.js ${nodeMajor}+ and ${nodeRange}.`,
    );
  }

  const ciNodeMajors = [
    ...ciText.matchAll(/node:\s*\[\s*(\d+)\s*\]/g),
    ...ciText.matchAll(/node-version:\s*(\d+)\b/g),
  ].map((match) => Number(match[1]));

  if (ciNodeMajors.length === 0) {
    errors.push('CI must declare at least one Node version.');
  } else if (ciNodeMajors.some((major) => major < nodeMajor)) {
    errors.push(
      `CI must not run a Node major below ${nodeMajor}: found ${ciNodeMajors.join(', ')}.`,
    );
  }

  if (!ciText.includes(`corepack prepare pnpm@${pnpmVersion} --activate`)) {
    errors.push(`CI must activate pnpm ${pnpmVersion}.`);
  }

  return errors;
}

function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const errors = validateRuntimeDocs({
    packageJsonText: readFileSync(resolve(repoRoot, 'package.json'), 'utf8'),
    readmeText: readFileSync(resolve(repoRoot, 'README.md'), 'utf8'),
    runtimeGuideText: readFileSync(
      resolve(repoRoot, 'docs/RTX_BITWIG_PREVIEW_RUNTIME.md'),
      'utf8',
    ),
    ciText: readFileSync(resolve(repoRoot, '.github/workflows/ci.yml'), 'utf8'),
  });

  if (errors.length > 0) {
    console.error('Runtime documentation contract mismatch:');
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log('Runtime documentation contract is aligned.');
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
