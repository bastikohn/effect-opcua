import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  // Pack with pnpm (not npm) so `catalog:` and `workspace:` protocol specifiers
  // are rewritten to concrete versions in the published manifest. Raw
  // `npm publish` ships package.json verbatim and would leave those
  // pnpm-only specifiers in the registry, where no package manager can resolve
  // them. We then hand the resolved tarball to `npm publish` to preserve
  // provenance / OIDC trusted publishing.
  const packDestination = mkdtempSync(join(tmpdir(), "opcua-pack-"));
  run("pnpm", ["pack", "--pack-destination", packDestination], {
    cwd: packagePath,
  });
  const tarballName = readdirSync(packDestination).find((file) =>
    file.endsWith(".tgz"),
  );
  if (!tarballName) {
    throw new Error(`pnpm pack produced no tarball for ${name}@${version}`);
  }
  const tarballPath = join(packDestination, tarballName);

  // Safety net: never publish a manifest that still carries unresolved
  // workspace-only protocols. This turns a silently broken publish into a
  // loud, pre-publish failure.
  const packedManifest = execFileSync(
    "tar",
    ["-xzOf", tarballPath, "package/package.json"],
    { encoding: "utf8" },
  );
  if (/"(?:catalog|workspace):/.test(packedManifest)) {
    throw new Error(
      `${name}@${version} tarball still contains unresolved catalog:/workspace: ` +
        `specifiers; refusing to publish. Check the pnpm pack step.`,
    );
  }

  const args = [
    "publish",
    tarballPath,
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
