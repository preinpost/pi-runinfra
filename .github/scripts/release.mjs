import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function checked(result, description) {
  if (result.status !== 0) {
    throw new Error(`${description} failed (exit ${result.status}):\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

export function bumpType(messages) {
  if (/^[a-z]+(?:\([^\n)]*\))?!:|^BREAKING[ -]CHANGE:/m.test(messages)) return "major";
  if (/^feat(?:\([^\n)]*\))?:/m.test(messages)) return "minor";
  if (/^(?:fix|perf)(?:\([^\n)]*\))?:/m.test(messages)) return "patch";
  return null;
}

export function versionParts(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Unsupported release version: ${version}`);
  return version.split(".").map(Number);
}

export function nextVersion(version, bump) {
  const [major, minor, patch] = versionParts(version);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`;
  throw new Error(`Unsupported bump: ${bump}`);
}

export function prepareRelease(cwd = process.cwd()) {
  const gitResult = (...args) => run("git", args, cwd);
  const git = (...args) => checked(gitResult(...args), `git ${args.join(" ")}`);
  const exists = (ref) => gitResult("rev-parse", "--verify", "--quiet", ref).status === 0;
  const ancestor = (a, b) => gitResult("merge-base", "--is-ancestor", a, b).status === 0;
  const manifestAt = (ref) => JSON.parse(git("show", `${ref}:package.json`));
  if (git("status", "--porcelain")) throw new Error("Release checkout must be clean.");
  git("fetch", "origin", "main", "--tags");
  const source = git("rev-parse", "HEAD");
  if (!ancestor(source, "origin/main")) throw new Error("Release source is not on origin/main.");
  const manifest = manifestAt(source);
  versionParts(manifest.version);
  const previous = gitResult("describe", "--tags", "--match", "v[0-9]*", "--abbrev=0", source);
  if (previous.status === 0) {
    assert.equal(previous.stdout.trim(), `v${manifest.version}`,
      "Package version must match the nearest release tag before preparing a release");
  }
  const range = previous.status === 0 ? `${previous.stdout.trim()}..${source}` : source;
  const bump = bumpType(git("log", "--format=%B", range));
  const version = bump ? nextVersion(manifest.version, bump) : manifest.version;
  const tag = `v${version}`;
  const tagRef = `refs/tags/${tag}`;

  // Validate an existing version commit before trusting it on a retry. Never
  // delete/move tags, or silently accept different code with the same version.
  function validateVersionCommit(commit) {
    assert.equal(git("show", "-s", "--format=%P", commit), source,
      `${tag} must be a direct release commit of the original source`);
    assert.equal(git("show", "-s", "--format=%s", commit), `chore(release): ${tag}`);
    assert.deepEqual(manifestAt(commit), { ...manifest, version },
      "Existing release manifest differs from the expected version bump");
    const files = git("diff", "--name-only", source, commit).split("\n");
    assert(files.includes("package.json") && files.every((file) =>
      ["package.json", "package-lock.json", "npm-shrinkwrap.json"].includes(file)),
    "Existing release changes files other than version metadata");
    assert(ancestor(commit, "origin/main"), "Existing release is not on origin/main");
  }

  if (!bump) {
    // A ci/docs-only push or a manual run can finish an already prepared release.
    if (!exists(tagRef)) return { skip: true };
    assert(ancestor(tagRef, source), `${tag} does not belong to this source history`);
    assert.equal(manifestAt(tagRef).version, version);
  } else if (exists(tagRef)) {
    validateVersionCommit(git("rev-parse", `${tagRef}^{commit}`));
    console.log(`Reusing ${tag}; version commit and tag already exist.`);
  } else if (git("rev-parse", "origin/main") !== source) {
    // Recover the old workflow's partial state: main was pushed, but its tag
    // push failed. Only its exact version-only child commit is eligible.
    const child = git("rev-list", "--reverse", "--ancestry-path", `${source}..origin/main`).split("\n")[0];
    validateVersionCommit(child);
    git("tag", tag, child);
    git("push", "origin", `${tagRef}:${tagRef}`);
  } else {
    git("config", "user.name", "github-actions[bot]");
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com");
    checked(run("npm", ["version", version, "--no-git-tag-version", "--ignore-scripts"], cwd), "npm version");
    const files = git("ls-files", "package.json", "package-lock.json", "npm-shrinkwrap.json").split("\n");
    git("add", "--", ...files);
    git("commit", "-m", `chore(release): ${tag}`);
    git("tag", tag);
    // A concurrent main update must fail both ref updates, not leave half a release.
    git("push", "--atomic", "origin", "HEAD:refs/heads/main", `${tagRef}:${tagRef}`);
  }

  const commit = git("rev-parse", `${tagRef}^{commit}`);
  const latestTag = git("tag", "--merged", "origin/main", "--sort=-v:refname")
    .split("\n").find((value) => /^v\d+\.\d+\.\d+$/.test(value));
  return { skip: false, version, tag, commit, latest: tag === latestTag };
}

export function resolveReleaseTag(tag, cwd = process.cwd()) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("A stable release tag such as v1.3.0 is required.");
  const git = (...args) => checked(run("git", args, cwd), `git ${args.join(" ")}`);
  git("fetch", "origin", "main", "--tags");
  const ref = `refs/tags/${tag}`;
  const commit = git("rev-parse", `${ref}^{commit}`);
  git("merge-base", "--is-ancestor", commit, "origin/main");
  const manifest = JSON.parse(git("show", `${commit}:package.json`));
  assert.equal(`v${manifest.version}`, tag, "Tag and package version must match");
  return { tag, version: manifest.version, commit };
}

export function ensureGitHubRelease(tag, latest, execute = run) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("A stable release tag is required.");
  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) throw new Error("GITHUB_REPOSITORY is required.");
  const existing = execute("gh", ["api", `repos/${repo}/releases/tags/${tag}`]);
  if (existing.status === 0) {
    assert.equal(JSON.parse(existing.stdout).tag_name, tag);
    console.log(`GitHub Release ${tag} already exists; skipping creation.`);
    return;
  }
  if (!/\bHTTP 404\b/.test(existing.stderr)) checked(existing, "GitHub Release lookup");
  checked(execute("gh", ["release", "create", tag, "--verify-tag", "--generate-notes", `--latest=${latest}`]),
    "GitHub Release creation");
}

export function publishNpm(cwd = process.cwd(), execute = run) {
  const manifest = JSON.parse(readFileSync(resolve(cwd, "package.json"), "utf8"));
  const { name, version } = manifest;
  versionParts(version);
  const registry = "https://registry.npmjs.org/";
  function lookup(spec) {
    const result = execute("npm", ["view", spec, "version", "--json", "--registry", registry], cwd);
    let value;
    try { value = JSON.parse(result.stdout); } catch { /* checked below */ }
    if (result.status === 0 && typeof value === "string") return value;
    if (result.status !== 0 && value?.error?.code === "E404") return null;
    checked(result, `npm registry lookup for ${spec}`);
    throw new Error(`Unexpected registry response for ${spec}`);
  }
  const spec = `${name}@${version}`;
  if (lookup(spec) === version) {
    console.log(`${spec} already on npm; skipping publication.`);
    return;
  }
  const latest = lookup(name);
  if (latest) {
    const a = versionParts(latest);
    const b = versionParts(version);
    const different = a.findIndex((value, i) => value !== b[i]);
    if (different !== -1 && a[different] > b[different]) {
      throw new Error(`Refusing to move npm latest backward from ${latest} to ${version}.`);
    }
  }
  // Fail before upload with a clear authentication error rather than npm's
  // misleading PUT 404 for expired/mis-scoped credentials.
  checked(execute("npm", ["whoami", "--registry", registry], cwd), "npm authentication (check NPM_TOKEN)");
  const published = execute("npm", ["publish", "--provenance", "--registry", registry], cwd);
  if (published.stdout) console.log(published.stdout.trim());
  if (published.stderr) console.error(published.stderr.trim());
  if (published.status === 0) return;
  // Another publisher or an ambiguous network result may have completed it.
  if (lookup(spec) === version) {
    console.log(`${spec} exists after publish failure; treating as success.`);
    return;
  }
  throw new Error(`npm publish failed (exit ${published.status}). Check NPM_TOKEN validity, package write permission and 2FA bypass. Retry the manual workflow with tag v${version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    switch (process.argv[2]) {
      case "prepare":
      case "resolve-tag": {
        const output = process.argv[2] === "prepare"
          ? prepareRelease()
          : resolveReleaseTag(process.env.RELEASE_TAG);
        console.log(JSON.stringify(output));
        if (process.env.GITHUB_OUTPUT) {
          appendFileSync(process.env.GITHUB_OUTPUT,
            Object.entries(output).map(([key, value]) => `${key}=${value}\n`).join(""));
        }
        break;
      }
      case "github-release":
        ensureGitHubRelease(process.argv[3], process.argv[4] === "true");
        break;
      case "publish":
        publishNpm();
        break;
      default:
        throw new Error("Usage: release.mjs prepare | resolve-tag (RELEASE_TAG env) | github-release <tag> <latest> | publish");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
