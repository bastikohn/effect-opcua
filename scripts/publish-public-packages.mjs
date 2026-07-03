import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const rootPath = fileURLToPath(new URL("..", import.meta.url));
const dryRun = process.argv.includes("--dry-run");

const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: rootPath,
    stdio: "inherit",
    env: { ...process.env, CI: "1" },
    ...options,
  });

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

// Returns the dist-tag to publish under. In changeset pre mode we mirror the
// configured pre tag (e.g. `alpha`) so a prerelease can never silently land on
// `latest`; stable releases fall through to `latest`.
const readPrereleaseTag = () => {
  try {
    const pre = readJson(join(rootPath, ".changeset", "pre.json"));
    if (pre.mode === "pre" && typeof pre.tag === "string") {
      return pre.tag;
    }
  } catch {
    // No pre.json (or unreadable): not in pre mode.
  }
  return "latest";
};

const distTag = readPrereleaseTag();

const workspacePackages = JSON.parse(
  execFileSync("pnpm", ["list", "--recursive", "--json", "--depth", "-1"], {
    cwd: rootPath,
    encoding: "utf8",
  }),
);

const publishablePackages = workspacePackages
  .filter((workspacePackage) => workspacePackage.private !== true)
  .map((workspacePackage) => {
    const packageJsonPath = join(workspacePackage.path, "package.json");
    return {
      ...workspacePackage,
      packageJson: readJson(packageJsonPath),
    };
  })
  .filter(
    (workspacePackage) =>
      workspacePackage.packageJson.publishConfig?.access === "public",
  );

if (publishablePackages.length === 0) {
  console.log("No public npm packages are configured for publishing.");
  process.exit(0);
}

const isPublished = ({ name, version }) => {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version", "--json"], {
      cwd: rootPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch (error) {
    const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
    if (output.includes("E404") || output.includes("404 Not Found")) {
      return false;
    }
    throw error;
  }
};

for (const workspacePackage of publishablePackages) {
  const { name, version, path: packagePath } = workspacePackage;

  if (isPublished({ name, version })) {
    console.log(`${name}@${version} is already published; skipping.`);
    continue;
  }

  const packageDir = relative(rootPath, packagePath);
  const args = [
    "publish",
    `./${packageDir}`,
    "--access",
    "public",
    "--tag",
    distTag,
    "--provenance",
  ];

  if (dryRun) args.push("--dry-run");

  console.log(`${dryRun ? "Dry-running" : "Publishing"} ${name}@${version}`);
  run("npm", args);
}
