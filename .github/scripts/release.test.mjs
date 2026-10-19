import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { bumpType, ensureGitHubRelease, nextVersion, prepareRelease, publishNpm, resolveReleaseTag } from "./release.mjs";

function fixture(t, { feature = true, tagged = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pi-runinfra-release-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  const cwd = join(root, "work");
  function exec(command, args, dir = cwd) {
    return execFileSync(command, args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  }
  exec("git", ["init", "--bare", remote], root);
  exec("git", ["clone", remote, cwd], root);
  const git = (...args) => exec("git", args);
  git("checkout", "-b", "main");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release-test@example.invalid");
  function commit(message) {
    git("add", ".");
    git("commit", "-m", message);
    return git("rev-parse", "HEAD");
  }
  function manifest(version = "1.2.0") {
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ name: "pi-runinfra-test", version }, null, 2) + "\n");
  }
  manifest();
  commit("chore: initialize");
  if (tagged) git("tag", "v1.2.0");
  if (feature) {
    writeFileSync(join(cwd, "model.txt"), "1017\n");
    commit("feat: add model");
  }
  git("push", "origin", "main", "--tags");
  const source = git("rev-parse", "HEAD");
  return { root, remote, cwd, git, commit, manifest, source };
}

function legacyVersionCommit(f) {
  f.manifest("1.3.0");
  return f.commit("chore(release): v1.3.0");
}

test("conventional commits select major/minor/patch, including breaking bodies", () => {
  assert.equal(bumpType("docs: note\nfeat(models): add model"), "minor");
  assert.equal(bumpType("fix: typo\n\nBREAKING CHANGE: changed API"), "major");
  assert.equal(bumpType("feat(models)!: replace API"), "major");
  assert.equal(bumpType("perf: speed"), "patch");
  assert.equal(bumpType("ci: recover releases"), null);
  assert.equal(nextVersion("1.2.3", "major"), "2.0.0");
  assert.equal(nextVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(nextVersion("1.2.3", "patch"), "1.2.4");
  assert.throws(() => nextVersion("1.2.3-beta.1", "minor"));
});

test("fresh release pushes commit/tag atomically; rerun from original SHA reuses them", (t) => {
  const f = fixture(t);
  const first = prepareRelease(f.cwd);
  assert.equal(first.version, "1.3.0");
  assert.equal(first.latest, true);
  assert.equal(f.git("rev-parse", "origin/main"), first.commit);
  assert.equal(f.git("show", "-s", "--format=%P", first.commit), f.source);
  assert.equal(f.git("rev-list", "--count", `${f.source}..origin/main`), "1");
  f.git("checkout", "--detach", f.source);
  assert.deepEqual(prepareRelease(f.cwd), first);
  assert.equal(f.git("rev-parse", "HEAD"), f.source);
  assert.deepEqual(resolveReleaseTag("v1.3.0", f.cwd), {
    tag: first.tag, version: first.version, commit: first.commit,
  });
});

test("ci-only push resumes the existing release without bumping or publishing new main contents", (t) => {
  const f = fixture(t);
  const released = prepareRelease(f.cwd);
  writeFileSync(join(f.cwd, "ci.txt"), "new release scripts\n");
  f.commit("ci: recover releases");
  f.git("push", "origin", "main");
  const result = prepareRelease(f.cwd);
  assert.equal(result.commit, released.commit);
  assert.equal(result.tag, "v1.3.0");
  assert.notEqual(result.commit, f.git("rev-parse", "HEAD"));
});

test("recovers legacy main-pushed/tag-missing state without another version commit", (t) => {
  const f = fixture(t);
  const versionCommit = legacyVersionCommit(f);
  f.git("push", "origin", "main");
  f.git("checkout", "--detach", f.source);
  const result = prepareRelease(f.cwd);
  assert.equal(result.commit, versionCommit);
  assert.equal(f.git("rev-parse", "v1.3.0"), versionCommit);
  assert.equal(f.git("rev-list", "--count", `${f.source}..origin/main`), "1");
});

test("rejects an unrelated tag instead of deleting or overwriting it", (t) => {
  const f = fixture(t);
  f.git("tag", "v1.3.0", f.source);
  f.git("push", "origin", "v1.3.0");
  assert.throws(() => prepareRelease(f.cwd), /nearest release tag/);
  assert.equal(f.git("rev-parse", "v1.3.0"), f.source);
});

test("rejects same-version release commits that changed package contents", (t) => {
  const f = fixture(t);
  f.manifest("1.3.0");
  writeFileSync(join(f.cwd, "model.txt"), "unexpected model\n");
  f.commit("chore(release): v1.3.0");
  f.git("tag", "v1.3.0");
  f.git("push", "origin", "main", "--tags");
  f.git("checkout", "--detach", f.source);
  assert.throws(() => prepareRelease(f.cwd), /other than version metadata/);
});

test("stale release cannot overwrite a newer unrelated main commit", (t) => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, "new.txt"), "new main\n");
  const tip = f.commit("feat: another model");
  f.git("push", "origin", "main");
  f.git("checkout", "--detach", f.source);
  assert.throws(() => prepareRelease(f.cwd));
  assert.equal(f.git("rev-parse", "origin/main"), tip);
  assert.throws(() => f.git("rev-parse", "--verify", "refs/tags/v1.3.0"));
});

test("rejected atomic push leaves neither a remote version commit nor a remote tag", (t) => {
  const f = fixture(t);
  const hook = join(f.remote, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  chmodSync(hook, 0o755);
  assert.throws(() => prepareRelease(f.cwd), /git push --atomic/);
  assert.equal(f.git("ls-remote", "origin", "refs/tags/v1.3.0"), "");
  assert(f.git("ls-remote", "origin", "refs/heads/main").startsWith(f.source));
});

test("a repository without release commits or a version tag skips", (t) => {
  const f = fixture(t, { feature: false, tagged: false });
  assert.deepEqual(prepareRelease(f.cwd), { skip: true });
});

test("manual recovery rejects invalid, missing, mismatched or off-main tags", (t) => {
  const f = fixture(t);
  assert.throws(() => resolveReleaseTag("main", f.cwd), /stable release tag/);
  assert.throws(() => resolveReleaseTag("v9.0.0", f.cwd));
  f.git("tag", "v9.0.0");
  f.git("push", "origin", "v9.0.0");
  assert.throws(() => resolveReleaseTag("v9.0.0", f.cwd), /Tag and package version/);
  f.git("checkout", "-b", "other");
  f.manifest("7.0.0");
  f.commit("feat: unrelated branch");
  f.git("tag", "v7.0.0");
  f.git("push", "origin", "v7.0.0");
  assert.throws(() => resolveReleaseTag("v7.0.0", f.cwd), /merge-base/);
});

const ok = (value = "") => ({ status: 0, stdout: value, stderr: "" });
const missing = () => ({ status: 1, stdout: JSON.stringify({ error: { code: "E404" } }), stderr: "not found" });

function npmFixture(t, responses) {
  const f = fixture(t);
  f.manifest("1.3.0");
  const calls = [];
  const execute = (command, args, cwd) => {
    assert.equal(command, "npm");
    assert.equal(cwd, f.cwd);
    calls.push(args);
    assert(responses.length > 0, `Unexpected npm call: ${args.join(" ")}`);
    return responses.shift();
  };
  return { ...f, calls, publish: () => publishNpm(f.cwd, execute) };
}

test("published npm version is an idempotent no-op", (t) => {
  const f = npmFixture(t, [ok('"1.3.0"')]);
  f.publish();
  assert.equal(f.calls.length, 1);
});

test("new npm version authenticates then publishes with provenance", (t) => {
  const f = npmFixture(t, [missing(), ok('"1.2.0"'), ok("user"), ok("published")]);
  f.publish();
  assert.equal(f.calls[2][0], "whoami");
  assert.deepEqual(f.calls[3], ["publish", "--provenance", "--registry", "https://registry.npmjs.org/"]);
});

test("registry network/auth failures are not treated as a missing version", (t) => {
  for (const code of ["E401", "E403", "ENETUNREACH"]) {
    const f = npmFixture(t, [{ status: 1, stdout: JSON.stringify({ error: { code } }), stderr: code }]);
    assert.throws(f.publish, /registry lookup/);
    assert.equal(f.calls.length, 1);
  }
});

test("invalid token fails the authentication preflight without uploading", (t) => {
  const f = npmFixture(t, [missing(), ok('"1.2.0"'), { status: 1, stdout: "", stderr: "E401" }]);
  assert.throws(f.publish, /check NPM_TOKEN/);
  assert(!f.calls.some((args) => args[0] === "publish"));
});

test("a duplicate/ambiguous publish is successful only when that exact version exists", (t) => {
  const conflict = { status: 1, stdout: "", stderr: "E409" };
  const f = npmFixture(t, [missing(), ok('"1.2.0"'), ok("user"), conflict, ok('"1.3.0"')]);
  f.publish();
  const failed = npmFixture(t, [missing(), ok('"1.2.0"'), ok("user"), conflict, missing()]);
  assert.throws(failed.publish, /Retry the manual workflow with tag v1.3.0/);
});

test("recovery never moves npm latest backward", (t) => {
  const f = npmFixture(t, [missing(), ok('"1.4.0"')]);
  assert.throws(f.publish, /latest backward/);
  assert.equal(f.calls.length, 2);
});

test("GitHub Release creation skips existing releases and only creates on a real 404", () => {
  const previous = process.env.GITHUB_REPOSITORY;
  process.env.GITHUB_REPOSITORY = "test/release";
  try {
    const calls = [];
    ensureGitHubRelease("v1.3.0", true, (command, args) => {
      calls.push(args);
      return ok('{"tag_name":"v1.3.0"}');
    });
    assert.equal(calls.length, 1);
    ensureGitHubRelease("v1.3.0", false, (command, args) => {
      if (args[0] === "api") return { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
      assert.deepEqual(args, ["release", "create", "v1.3.0", "--verify-tag", "--generate-notes", "--latest=false"]);
      return ok();
    });
    assert.throws(() => ensureGitHubRelease("v1.3.0", true,
      () => ({ status: 1, stdout: "", stderr: "HTTP 403" })), /lookup failed/);
  } finally {
    if (previous === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = previous;
  }
});
