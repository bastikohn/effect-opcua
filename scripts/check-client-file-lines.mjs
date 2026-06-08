import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const root = process.cwd();
const sourceRoot = resolve(root, "packages/client/src");
const allowlistPath = resolve(root, "scripts/client-file-line-allowlist.json");
const maxLines = 1000;

const toRepoPath = (path) => relative(root, path).split(sep).join("/");

const listTypeScriptFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return listTypeScriptFiles(path);
    return entry.isFile() && entry.name.endsWith(".ts") ? [path] : [];
  });

const countPhysicalLines = (path) => {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) return 0;
  return text.endsWith("\n")
    ? text.split("\n").length - 1
    : text.split("\n").length;
};

const readAllowlist = () => {
  const parsed = JSON.parse(readFileSync(allowlistPath, "utf8"));
  if (
    !Array.isArray(parsed) ||
    !parsed.every((entry) => typeof entry === "string")
  ) {
    throw new Error(
      "scripts/client-file-line-allowlist.json must be a JSON string array",
    );
  }
  return new Set(parsed);
};

const allowlist = readAllowlist();
const files = listTypeScriptFiles(sourceRoot).map((path) => ({
  path,
  repoPath: toRepoPath(path),
  lines: countPhysicalLines(path),
}));
const byRepoPath = new Map(files.map((file) => [file.repoPath, file]));
const failures = [];

for (const entry of allowlist) {
  const file = byRepoPath.get(entry);
  if (!file) {
    failures.push(`${entry} is allowlisted but does not exist`);
  } else if (file.lines <= maxLines) {
    failures.push(
      `${entry} is allowlisted at ${file.lines} lines; remove it from the allowlist`,
    );
  }
}

for (const file of files) {
  if (file.lines > maxLines && !allowlist.has(file.repoPath)) {
    failures.push(`${file.repoPath} has ${file.lines} lines`);
  }
}

if (!existsSync(sourceRoot)) {
  failures.push("packages/client/src does not exist");
}

if (failures.length > 0) {
  console.error(`Client source files must stay at or below ${maxLines} lines.`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `Checked ${files.length} client source files; no line-count violations.`,
  );
}
