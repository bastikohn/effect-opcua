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

// npm hands the very first publish the `latest` dist-tag and never moves it
// for prerelease publishes, so bare `npm install <name>` would keep resolving
// to a stale early alpha. While every published version is still a
// prerelease, follow each publish by moving `latest` to it. Once a stable
// release exists it owns `latest` (via the distTag fallthrough above) and
// this must not touch it anymore.
const publishedVersions = (name) => {
  const output = execFileSync("npm", ["view", name, "versions", "--json"], {
    cwd: rootPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const versions = JSON.parse(output);
  return Array.isArray(versions) ? versions : [versions];
};

const syncLatestTagForPrerelease = ({ name, version }) => {
  const isPrerelease = (v) => v.includes("-");
  if (!isPrerelease(version)) return;
  if (!publishedVersions(name).every(isPrerelease)) return;
  console.log(`Moving ${name} dist-tag \`latest\` to ${version}`);
  run("npm", ["dist-tag", "add", `${name}@${version}`, "latest"]);
};

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

const tagExists = (tag) =>
  execFileSync("git", ["tag", "--list", tag], {
    cwd: rootPath,
    encoding: "utf8",
  }).trim() === tag;

const releaseExists = (tag) => {
  try {
    execFileSync("gh", ["release", "view", tag], {
      cwd: rootPath,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
};

// Returns the CHANGELOG.md section for `version` (as written by changesets),
// so the GitHub release carries the same notes as the changelog.
const readChangelogEntry = (packagePath, version) => {
  let changelog;
  try {
    changelog = readFileSync(join(packagePath, "CHANGELOG.md"), "utf8");
  } catch {
    return undefined;
  }
  const lines = changelog.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${version}`);
  if (start === -1) {
    return undefined;
  }
  let end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## "),
  );
  if (end === -1) {
    end = lines.length;
  }
  const entry = lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
  return entry === "" ? undefined : entry;
};

// Tags and GitHub releases are created for every published version, not only
// the ones this run publishes, so a rerun repairs a release that failed
// between the npm publish and the tag/release steps.
const tagAndRelease = ({ name, version, path: packagePath }) => {
  const tag = `${name}@${version}`;
  if (!tagExists(tag)) {
    run("git", ["tag", tag]);
  }
  run("git", ["push", "origin", `refs/tags/${tag}`]);
  if (!process.env.GITHUB_TOKEN && !process.env.GH_TOKEN) {
    console.warn(`No GITHUB_TOKEN/GH_TOKEN; skipping GitHub release ${tag}.`);
    return;
  }
  if (releaseExists(tag)) {
    console.log(`GitHub release ${tag} already exists; skipping.`);
    return;
  }
  const notes = readChangelogEntry(packagePath, version) ?? `Release ${tag}.`;
  run("gh", [
    "release",
    "create",
    tag,
    "--title",
    tag,
    "--notes",
    notes,
    ...(version.includes("-") ? ["--prerelease"] : []),
  ]);
};

const publishPackage = ({ name, version, path: packagePath }) => {
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

  if (!dryRun && distTag !== "latest") {
    syncLatestTagForPrerelease({ name, version });
  }
};

for (const workspacePackage of publishablePackages) {
  const { name, version } = workspacePackage;

  if (isPublished({ name, version })) {
    console.log(`${name}@${version} is already published; skipping publish.`);
  } else {
    publishPackage(workspacePackage);
  }

  if (!dryRun) {
    tagAndRelease(workspacePackage);
  }
}
