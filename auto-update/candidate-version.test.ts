import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readCandidateVersion } from "./candidate-version";

const exec = promisify(execFile);
let repository: string;
const commits: Record<string, string> = {};
const git = async (...args: string[]) =>
  (await exec("git", ["-C", repository, ...args])).stdout.trim();

beforeAll(async () => {
  repository = await mkdtemp(join(tmpdir(), "bb-auto-update-fixture-"));
  await git("init", "--quiet");
  await git("config", "user.name", "Version Test");
  await git("config", "user.email", "version-test@example.invalid");
  await mkdir(join(repository, "nested", "plugin"), { recursive: true });
  const commit = async (name: string) => {
    await git("add", ".");
    await git("-c", "commit.gpgsign=false", "commit", "--quiet", "-m", name);
    commits[name] = await git("rev-parse", "HEAD");
  };
  await writeFile(join(repository, "package.json"), '{"version":"1.0.0"}');
  await writeFile(
    join(repository, "nested", "plugin", "package.json"),
    '{"version":"0.1.0"}',
  );
  await commit("initial");
  await writeFile(
    join(repository, "unrelated.txt"),
    "Another plugin changed.\n",
  );
  await commit("unrelated");
  await writeFile(join(repository, "package.json"), '{"version":"1.1.0"}');
  await writeFile(
    join(repository, "nested", "plugin", "package.json"),
    '{"version":"0.1.1"}',
  );
  await commit("release");
  await writeFile(join(repository, "package.json"), '{"name":"no-version"}');
  await commit("missing");
  await writeFile(join(repository, "package.json"), '{"version":"   "}');
  await commit("blank");
  await writeFile(join(repository, "package.json"), "not JSON");
  await commit("malformed");
});

afterAll(async () => {
  if (repository) await rm(repository, { recursive: true, force: true });
});

const source = () => ({
  requested: `git:${pathToFileURL(repository).href}@main`,
});
const scratch = async () =>
  (await readdir(tmpdir()))
    .filter((name) => name.startsWith("bb-auto-update-version-"))
    .sort();

/** Exercise real transports without network requests or real credentials. */
async function withRepositoryAlias(url: string, run: () => Promise<void>) {
  vi.stubEnv("GIT_CONFIG_COUNT", "1");
  vi.stubEnv(
    "GIT_CONFIG_KEY_0",
    `url.${pathToFileURL(repository).href}.insteadOf`,
  );
  vi.stubEnv("GIT_CONFIG_VALUE_0", url);
  try {
    await run();
  } finally {
    vi.unstubAllEnvs();
  }
}

describe("candidate package version", () => {
  it("reads npm versions without Git", async () => {
    await expect(
      readCandidateVersion(
        { requested: "npm:@example/plugin@latest" },
        " 1.2.3 ",
      ),
    ).resolves.toBe("1.2.3");
    await expect(
      readCandidateVersion({ requested: "npm:plugin" }, " "),
    ).rejects.toThrow("has no version");
  });

  it("reads the exact commit, ignoring unrelated commits and newer releases", async () => {
    const before = await scratch();
    await expect(readCandidateVersion(source(), commits.initial)).resolves.toBe(
      "1.0.0",
    );
    await expect(
      readCandidateVersion(source(), commits.unrelated),
    ).resolves.toBe("1.0.0");
    await expect(readCandidateVersion(source(), commits.release)).resolves.toBe(
      "1.1.0",
    );
    expect(await scratch()).toEqual(before);
  });

  it("reads the selected plugin subdirectory", async () => {
    const nested = { ...source(), subdirectory: "nested/plugin" };
    await expect(readCandidateVersion(nested, commits.unrelated)).resolves.toBe(
      "0.1.0",
    );
    await expect(readCandidateVersion(nested, commits.release)).resolves.toBe(
      "0.1.1",
    );
  });

  it("supports absolute local Git sources", async () => {
    await expect(
      readCandidateVersion(
        { requested: `git:${repository}@main` },
        commits.initial,
      ),
    ).resolves.toBe("1.0.0");
  });

  it.each([
    "https://user:password@example.invalid/repo.git",
    "ssh://git@example.invalid/org/repo.git",
    "git@example.invalid:org/repo.git",
  ])("preserves credentials in %s, with or without a ref", async (url) => {
    await withRepositoryAlias(url, async () => {
      for (const suffix of ["", "@main"]) {
        await expect(
          readCandidateVersion(
            { requested: `git:${url}${suffix}` },
            commits.initial,
          ),
        ).resolves.toBe("1.0.0");
      }
    });
  });

  it("accepts shorthand and raw HTTPS Git sources", async () => {
    const url = "https://example.invalid/org/repo.git";
    await withRepositoryAlias(url, async () => {
      for (const requested of [
        "git:example.invalid/org/repo.git@main",
        `${url}@main`,
      ]) {
        await expect(
          readCandidateVersion({ requested }, commits.initial),
        ).resolves.toBe("1.0.0");
      }
    });
  });

  it.each(["missing", "blank", "malformed"])(
    "rejects a %s manifest version",
    async (name) => {
      await expect(
        readCandidateVersion(source(), commits[name]),
      ).rejects.toThrow(
        name === "malformed" ? "not valid JSON" : "has no version",
      );
    },
  );

  it.each([
    "../other",
    "/absolute",
    "nested/../other",
    "C:\\other",
    "nested/.git",
    "nested//plugin",
  ])("rejects unsafe subdirectory %s", async (subdirectory) => {
    await expect(
      readCandidateVersion({ ...source(), subdirectory }, commits.initial),
    ).rejects.toThrow("Invalid plugin subdirectory");
  });

  it("rejects a ref instead of an exact commit", async () => {
    await expect(readCandidateVersion(source(), "main")).rejects.toThrow(
      "Invalid candidate commit",
    );
  });

  it("removes temporary repositories after fetch failure without exposing source details", async () => {
    const before = await scratch();
    await expect(
      readCandidateVersion(
        { requested: `git:${repository}/secret-location@main` },
        commits.initial,
      ),
    ).rejects.toThrow("Could not fetch the candidate plugin manifest.");
    expect(await scratch()).toEqual(before);
  });
});
