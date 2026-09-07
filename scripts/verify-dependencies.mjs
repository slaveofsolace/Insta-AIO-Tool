import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockfile = await readFile(path.join(projectRoot, "pnpm-lock.yaml"), "utf8");
const workspaceConfig = await readFile(path.join(projectRoot, "pnpm-workspace.yaml"), "utf8");
const requireFromProject = createRequire(path.join(projectRoot, "package.json"));
const expectedVersions = ["1.1.18", "2.1.4", "5.0.9"];

for (const version of expectedVersions) {
  assert.match(
    lockfile,
    new RegExp(`^  brace-expansion@${version.replaceAll(".", "\\.")}:$`, "m"),
    `pnpm-lock.yaml must resolve brace-expansion ${version}`,
  );

  const packageRoot = path.join(
    projectRoot,
    "node_modules",
    ".pnpm",
    `brace-expansion@${version}`,
    "node_modules",
    "brace-expansion",
  );
  const packageMetadata = requireFromProject(path.join(packageRoot, "package.json"));
  const moduleExports = requireFromProject(packageRoot);
  const expand = typeof moduleExports === "function" ? moduleExports : moduleExports.expand;

  assert.equal(packageMetadata.version, version);
  assert.equal(typeof expand, "function", `${version} must expose an expansion function`);
  assert.deepEqual(
    expand("{ab,cd}{ef,gh}", { maxLength: 5 }),
    ["abef"],
    `${version} must enforce the aggregate expansion-length bound`,
  );

  const sourcePath =
    version.startsWith("5.")
      ? path.join(packageRoot, "dist", "commonjs", "index.js")
      : path.join(packageRoot, "index.js");
  const source = await readFile(sourcePath, "utf8");
  assert.match(source, /CVE-2026-14257/);
  assert.match(source, /EXPANSION_MAX_LENGTH/);
}

const patchedBuildDependencies = [
  {
    name: "fast-uri",
    version: "3.1.6",
    override: '"fast-uri@<3.1.6": 3.1.6',
  },
  {
    name: "js-yaml",
    version: "4.3.1",
    override: '"js-yaml@<4.3.1": 4.3.1',
  },
];

for (const dependency of patchedBuildDependencies) {
  const escapedVersion = dependency.version.replaceAll(".", "\\.");
  assert.match(
    lockfile,
    new RegExp(`^  ${dependency.name}@${escapedVersion}:$`, "m"),
    `pnpm-lock.yaml must resolve ${dependency.name} ${dependency.version}`,
  );
  assert.ok(
    workspaceConfig.includes(dependency.override),
    `pnpm-workspace.yaml must retain the ${dependency.name} security override`,
  );

  const packageMetadata = requireFromProject(path.join(
    projectRoot,
    "node_modules",
    ".pnpm",
    `${dependency.name}@${dependency.version}`,
    "node_modules",
    dependency.name,
    "package.json",
  ));
  assert.equal(packageMetadata.version, dependency.version);
}

console.log(
  `Dependency verification passed: brace-expansion ${expectedVersions.join(", ")} enforce the CVE-2026-14257 length bound; fast-uri 3.1.6 and js-yaml 4.3.1 are patched.`,
);
