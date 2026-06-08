import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const root = process.cwd();
const clientSourceRoot = resolve(root, "packages/client/src");
const internalRoot = resolve(clientSourceRoot, "internal");
const sourceExtensions = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const allowedClientSubpaths = new Set([
  "@effect-opcua/client/node-opcua",
  "@effect-opcua/client/package.json",
]);
const ignoredDirectories = new Set([
  ".git",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);
const explicitSmokeFiles = new Set(["scripts/package-smoke.mjs"]);

const toRepoPath = (path) => relative(root, path).split(sep).join("/");
const extensionOf = (path) => {
  const match = /\.[^.]+$/.exec(path);
  return match?.[0] ?? "";
};

const walk = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) return [];
      return walk(path);
    }
    return entry.isFile() ? [path] : [];
  });

const sourceFiles = walk(root).filter((path) =>
  sourceExtensions.has(extensionOf(path)),
);
const internalFiles = walk(internalRoot).filter((path) => path.endsWith(".ts"));
const failures = [];

const importSpecifierPattern =
  /\bimport\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|\bexport\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)["']([^"']+)["']/g;

const getImportSpecifiers = (text) =>
  [...text.matchAll(importSpecifierPattern)].map(
    (match) => match[1] ?? match[2] ?? match[3],
  );

for (const path of internalFiles) {
  const repoPath = toRepoPath(path);
  const text = readFileSync(path, "utf8");
  for (const specifier of getImportSpecifiers(text)) {
    if (specifier.startsWith("@effect-opcua/client")) {
      failures.push(
        `${repoPath} imports ${specifier}; use a relative source import`,
      );
    }
  }
}

for (const path of sourceFiles) {
  const repoPath = toRepoPath(path);
  if (explicitSmokeFiles.has(repoPath)) continue;
  const text = readFileSync(path, "utf8");
  for (const specifier of getImportSpecifiers(text)) {
    if (
      specifier.startsWith("@effect-opcua/client/") &&
      !allowedClientSubpaths.has(specifier)
    ) {
      failures.push(`${repoPath} imports blocked client subpath ${specifier}`);
    }
  }
}

const indexPath = resolve(clientSourceRoot, "index.ts");
const exportsTestPath = resolve(root, "packages/client/test/exports.test.ts");
const indexText = readFileSync(indexPath, "utf8");
const exportsTestText = readFileSync(exportsTestPath, "utf8");
const runtimeNamespaces = [
  ...indexText.matchAll(
    /export\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s+["'][^"']+["']/g,
  ),
].map((match) => match[1]);

for (const namespace of runtimeNamespaces) {
  if (!exportsTestText.includes(`"${namespace}"`)) {
    failures.push(
      `index.ts exports runtime namespace ${namespace} without exports.test.ts coverage`,
    );
  }
}

if (failures.length > 0) {
  console.error("Client boundary check failed.");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log("Client boundary check passed.");
}
