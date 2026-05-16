import { describe, it, expect } from "vitest";
import { evaluateTier, isProtectedPath } from "./tiers";

describe("isProtectedPath", () => {
  it("blocks .git/", () => {
    expect(isProtectedPath("repo/.git/config")).toBe(true);
  });

  it("blocks .env", () => {
    expect(isProtectedPath(".env")).toBe(true);
    expect(isProtectedPath(".env.local")).toBe(true);
  });

  it("blocks .pi/", () => {
    expect(isProtectedPath(".pi/settings.json")).toBe(true);
  });

  it("blocks node_modules/", () => {
    expect(isProtectedPath("node_modules/foo/package.json")).toBe(true);
  });

  it("blocks shell configs", () => {
    expect(isProtectedPath("~/.bashrc")).toBe(true);
    expect(isProtectedPath("~/.zshrc")).toBe(true);
  });

  it("blocks ~/.ssh/", () => {
    expect(isProtectedPath("~/.ssh/id_rsa")).toBe(true);
  });

  it("allows normal project files", () => {
    expect(isProtectedPath("src/index.ts")).toBe(false);
    expect(isProtectedPath("README.md")).toBe(false);
  });
});

describe("evaluateTier", () => {
  const cwd = "/home/user/project";

  it("Tier 1: read/grep/find/ls are always allowed", () => {
    expect(evaluateTier("read", { path: "/etc/passwd" }, cwd).kind).toBe("allow");
    expect(evaluateTier("grep", { pattern: "foo", path: "." }, cwd).kind).toBe("allow");
    expect(evaluateTier("find", { path: "." }, cwd).kind).toBe("allow");
    expect(evaluateTier("ls", { path: "." }, cwd).kind).toBe("allow");
  });

  it("Tier 2: write/edit within cwd are allowed", () => {
    expect(evaluateTier("write", { path: "/home/user/project/src/foo.ts" }, cwd).kind).toBe("allow");
    expect(evaluateTier("edit", { path: "/home/user/project/README.md" }, cwd).kind).toBe("allow");
  });

  it("Tier 2: write/edit outside cwd require evaluation", () => {
    expect(evaluateTier("write", { path: "/tmp/outside.ts" }, cwd).kind).toBe("evaluate");
    expect(evaluateTier("edit", { path: "../sibling/file.ts" }, cwd).kind).toBe("evaluate");
  });

  it("Tier 2: does not falsely match sibling directories", () => {
    expect(evaluateTier("write", { path: "/home/user/project-secrets" }, cwd).kind).toBe("evaluate");
    expect(evaluateTier("write", { path: "../project-other/file.ts" }, cwd).kind).toBe("evaluate");
  });

  it("Protected paths block write/edit unconditionally", () => {
    const writeGit = evaluateTier("write", { path: ".git/config" }, cwd);
    expect(writeGit.kind).toBe("block");
    expect((writeGit as any).reason).toContain("protected");

    const editEnv = evaluateTier("edit", { path: ".env" }, cwd);
    expect(editEnv.kind).toBe("block");
  });

  it("bash with protected path references blocks", () => {
    const result = evaluateTier("bash", { command: "cat ~/.ssh/id_rsa" }, cwd);
    expect(result.kind).toBe("block");
    expect((result as any).reason).toContain("protected");
  });

  it("bash without protected path references requires evaluation", () => {
    const result = evaluateTier("bash", { command: "npm test" }, cwd);
    expect(result.kind).toBe("evaluate");
  });

  it("unknown tools require evaluation", () => {
    expect(evaluateTier("fetch", { url: "https://example.com" }, cwd).kind).toBe("evaluate");
  });
});
