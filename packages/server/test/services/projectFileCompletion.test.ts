import { mkdtemp, mkdir, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ProjectFileCompletion } from "../../src/services/projectFileCompletion.js";
import { runGit } from "../../src/git/gitExec.js";
import { createProjectFileCompletionRoutes } from "../../src/routes/project-file-completion.js";
import type { ProjectScanner } from "../../src/projects/scanner.js";
import {
  toUrlProjectId,
  type ProjectFileCompletionResult,
} from "@yep-anywhere/shared";

const temporary: string[] = [];

it("serves Git paths through the project route, ranking recency first and rechecking changed ignores", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-route-"));
  temporary.push(root);
  const project = join(root, "project");
  await mkdir(project);
  await runGit(project, ["init", "--template="]);
  for (const path of ["a-file.txt", "z-file.txt", "untracked-file.txt"])
    await writeFile(join(project, path), "fixture");
  await runGit(project, ["add", "a-file.txt", "z-file.txt"]);
  const id = toUrlProjectId(project);
  const routes = createProjectFileCompletionRoutes({
    scanner: {
      getProject: async () => ({ path: project }),
    } as unknown as ProjectScanner,
    dataDir: join(root, "data"),
  });
  const query = async () => {
    const response = await routes.request(
      `/${id}/file-completion?q=file&recent=z-file.txt`,
    );
    expect(response.status).toBe(200);
    return (await response.json()) as ProjectFileCompletionResult;
  };
  let result = await query();
  for (let i = 0; result.pending && i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = await query();
  }
  expect(result.pending).toBe(false);
  expect(result.entries.map((entry) => entry.path)).toEqual([
    "z-file.txt",
    "a-file.txt",
    "untracked-file.txt",
  ]);
  await writeFile(
    join(project, ".gitignore"),
    "z-file.txt\nuntracked-file.txt\n",
  );
  expect((await query()).entries.map((entry) => entry.path)).toEqual([
    "a-file.txt",
  ]);
  await rm(join(project, "a-file.txt"));
  expect((await query()).entries).toEqual([]);
  expect(
    (await routes.request(`/${id}/file-completion?q=two%20words`)).status,
  ).toBe(400);
});
afterEach(async () => {
  await Promise.all(
    temporary.splice(0).map((path) => rm(path, { recursive: true })),
  );
});

it("honors nested gitignore in a non-Git project without writing project metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "ya-completion-"));
  temporary.push(root);
  const project = join(root, "project");
  await mkdir(join(project, "nested"), { recursive: true });
  await writeFile(join(project, ".gitignore"), "*.log\n");
  await writeFile(join(project, "nested/.gitignore"), "*.txt\n!keep.txt\n");
  for (const path of ["nested/hide.txt", "nested/keep.txt", "error.log"])
    await writeFile(join(project, path), "fixture");
  const before = await readdir(project);
  const service = new ProjectFileCompletion(join(root, "data"));
  let result = await service.query(project, "nested", []);
  for (let i = 0; result.pending && i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    result = await service.query(project, "nested", []);
  }
  expect(result.pending).toBe(false);
  expect(result.entries.map((entry) => entry.path)).toEqual([
    "nested/",
    "nested/.gitignore",
    "nested/keep.txt",
  ]);
  expect(await readdir(project)).toEqual(before);
  expect(
    (await service.query(project, "hide", ["nested/hide.txt"])).entries,
  ).toEqual([]);
});
