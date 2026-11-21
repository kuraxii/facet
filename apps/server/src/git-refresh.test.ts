/**
 * 仓库级调度的测试。
 *
 * 覆盖冷却、合并方式（latest-wins 取代在途 / single-flight 搭车）、`force` 与失败恢复。
 * 探针换成计数用的假实现，所以断言的是「拉起了几次探测」「那一批有没有被真的收掉」，与
 * 真实 git 无关；`resolveKey` 也换成恒等函数，省掉每条用例去 spawn 一次 rev-parse。
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitCommitDetail, GitCommits, GitDiff, GitStatus } from "@facet/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitStatus } from "./git.ts";
import { GitAbortedError } from "./git-exec.ts";
import { GitRefreshService } from "./git-refresh.ts";

/** 一次探测的结果，内容不重要，只用来比对是不是同一份。 */
function statusOf(tag: string): GitStatus {
	return { isRepo: true, branch: tag, files: [] };
}

/** 调度键就地取调用方给的目录：用例里不跑 rev-parse。 */
async function sameKey(cwd: string): Promise<string> {
	return cwd;
}

/**
 * 假探针：记下调用次数，每次给一个带序号的结果。
 *
 * `hold()` 之后探测挂住，直到用例 `let_go()`；`onAbort` 让用例看得见「那一条被子进程收掉」。
 */
function probeStub() {
	let calls = 0;
	let holdNext = false;
	let pending: (() => void) | undefined;
	let abortedCount = 0;
	const probe = async (_repo: string, signal?: AbortSignal): Promise<GitStatus> => {
		calls += 1;
		const tag = `run-${calls}`;
		if (holdNext) {
			holdNext = false;
			await new Promise<void>((resolve, reject) => {
				pending = resolve;
				signal?.addEventListener(
					"abort",
					() => {
						abortedCount += 1;
						reject(new GitAbortedError());
					},
					{ once: true },
				);
			});
		}
		return statusOf(tag);
	};
	return {
		probe,
		get calls(): number {
			return calls;
		},
		get aborted(): number {
			return abortedCount;
		},
		/** 让下一次探测挂住，直到 `let_go()`。 */
		hold(): void {
			holdNext = true;
		},
		let_go(): void {
			const resume = pending;
			pending = undefined;
			resume?.();
		},
	};
}

/** 假的提交历史探针：只记调用次数，每次给一个不同 sha 的列表。 */
function commitsStub() {
	let calls = 0;
	const probe = async (): Promise<GitCommits> => {
		calls += 1;
		return {
			isRepo: true,
			commits: [
				{
					sha: `sha-${calls}`,
					shortSha: `s${calls}`,
					subject: `第 ${calls} 次`,
					body: "",
					authorName: "facet",
					authorEmail: "facet@example.com",
					authorDate: "2024-01-01T00:00:00Z",
				},
			],
		};
	};
	return {
		probe,
		get calls(): number {
			return calls;
		},
	};
}

const roots: string[] = [];

afterEach(async () => {
	for (const root of roots.splice(0)) {
		await rm(root, { recursive: true, force: true });
	}
});

/** 建一个临时仓库并提交一次。 */
async function createRepo(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "facet-refresh-"));
	roots.push(root);
	const env = {
		...process.env,
		GIT_AUTHOR_NAME: "facet",
		GIT_AUTHOR_EMAIL: "facet@example.com",
		GIT_COMMITTER_NAME: "facet",
		GIT_COMMITTER_EMAIL: "facet@example.com",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_SYSTEM: "/dev/null",
	};
	execFileSync("git", ["-C", root, "init", "-b", "main"], { env });
	await writeFile(join(root, "a.txt"), "一行\n", "utf8");
	execFileSync("git", ["-C", root, "add", "."], { env });
	execFileSync("git", ["-C", root, "commit", "-m", "初始提交"], { env });
	return root;
}

describe("GitRefreshService", () => {
	it("同一批并发请求只拉起一次探测", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({
			cooldownMs: 40,
			resolveKey: sameKey,
			probeStatus: stub.probe,
		});

		const results = await Promise.all(Array.from({ length: 10 }, async () => await service.status("/repo")));

		expect(stub.calls).toBe(1);
		// 十个人拿的是同一份结果：run-1
		expect(new Set(results.map((status) => status.branch))).toEqual(new Set(["run-1"]));
	});

	it("提交历史有自己的车道：并发请求只跑一轮", async () => {
		const stub = commitsStub();
		const service = new GitRefreshService({
			commitsCooldownMs: 40,
			resolveKey: sameKey,
			probeCommits: stub.probe,
		});

		const results = await Promise.all(Array.from({ length: 10 }, async () => await service.commits("/repo")));

		expect(stub.calls).toBe(1);
		expect(results.every((result) => result.commits[0]?.sha === "sha-1")).toBe(true);
	});

	it("状态与提交历史各排各的，互不吃对方的冷却", async () => {
		const status = probeStub();
		const commits = commitsStub();
		const service = new GitRefreshService({
			cooldownMs: 5000,
			commitsCooldownMs: 5000,
			resolveKey: sameKey,
			probeStatus: status.probe,
			probeCommits: commits.probe,
		});

		await service.status("/repo");
		// 状态刚跑完、正在冷却，提交历史照样立刻能跑
		await service.commits("/repo");
		expect(status.calls).toBe(1);
		expect(commits.calls).toBe(1);
	});

	it("force 跳过冷却，立刻再跑一次", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({
			cooldownMs: 5000,
			resolveKey: sameKey,
			probeStatus: stub.probe,
		});

		await service.status("/repo");
		const forced = await service.status("/repo", { force: true });
		expect(stub.calls).toBe(2);
		expect(forced.branch).toBe("run-2");
	});

	it("冷却窗口里的请求等到冷却结束才跑", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({
			cooldownMs: 120,
			resolveKey: sameKey,
			probeStatus: stub.probe,
		});

		await service.status("/repo");
		expect(stub.calls).toBe(1);

		const pending = service.status("/repo");
		await new Promise((resolve) => setTimeout(resolve, 40));
		// 冷却还没走完，不该拉起新探测
		expect(stub.calls).toBe(1);
		await pending;
		expect(stub.calls).toBe(2);
	});

	it("新请求取代在途的状态探测：旧子进程被收掉，等待者一起拿最新结果", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({
			cooldownMs: 5000,
			resolveKey: sameKey,
			probeStatus: stub.probe,
		});

		stub.hold();
		const first = service.status("/repo");
		await vi.waitFor(() => expect(stub.calls).toBe(1));

		// 第二个请求进来时立刻把在途那一条收掉
		const second = service.status("/repo");
		stub.let_go();
		await vi.waitFor(() => expect(stub.calls).toBe(2), { timeout: 2000, interval: 10 });

		// 被取代的那一轮不作数，先来的那一方也等最新结果
		expect((await first).branch).toBe("run-2");
		expect((await second).branch).toBe("run-2");
		expect(stub.aborted).toBe(1);
	});

	it("不可变的提交详情按 (仓库, 提交) 搭车：并发只派生一次", async () => {
		let calls = 0;
		const service = new GitRefreshService({
			resolveKey: sameKey,
			probeCommit: async (_repo, sha): Promise<GitCommitDetail> => {
				calls += 1;
				await new Promise((resolve) => setTimeout(resolve, 10));
				return {
					commit: {
						sha,
						shortSha: sha.slice(0, 7),
						subject: "标题",
						body: "",
						authorName: "facet",
						authorEmail: "facet@example.com",
						authorDate: "2024-01-01T00:00:00Z",
					},
					files: [],
				};
			},
		});

		const details = await Promise.all(
			Array.from({ length: 5 }, async () => await service.commit("/repo", "abcdef1")),
		);
		expect(calls).toBe(1);
		expect(new Set(details.map((detail) => detail.commit.sha))).toEqual(new Set(["abcdef1"]));

		// 换一个提交就该各算一次
		await service.commit("/repo", "abcdef2");
		expect(calls).toBe(2);
	});

	it("工作区单文件补丁按文件分开排队，同文件的新请求取代旧的", async () => {
		let calls = 0;
		const seen: string[] = [];
		const service = new GitRefreshService({
			resolveKey: sameKey,
			probeDiff: async (_repo, path): Promise<GitDiff> => {
				calls += 1;
				seen.push(path);
				return { patch: "", truncated: false, binary: false };
			},
		});

		await Promise.all([service.diff("/repo", "a.ts"), service.diff("/repo", "b.ts")]);
		expect(calls).toBe(2);
		expect(new Set(seen)).toEqual(new Set(["a.ts", "b.ts"]));
	});

	it("分页历史按页合并：同一页的并发请求只跑一次", async () => {
		const stub = commitsStub();
		const service = new GitRefreshService({
			cooldownMs: 5000,
			resolveKey: sameKey,
			probeCommits: stub.probe,
		});

		await Promise.all([service.commits("/repo", { limit: 20 }), service.commits("/repo", { limit: 20 })]);
		expect(stub.calls).toBe(1);

		// 换一页是另一条键
		await service.commits("/repo", { limit: 20, skip: 20 });
		expect(stub.calls).toBe(2);
	});

	it("200ms 里连着来 10 次请求，真仓库上最多跑两轮探测", async () => {
		const root = await createRepo();
		let rounds = 0;
		const service = new GitRefreshService({
			probeStatus: async (repoRoot: string, signal: AbortSignal) => {
				rounds += 1;
				return await gitStatus(repoRoot, { signal });
			},
		});

		await writeFile(join(root, "a.txt"), "改过\n", "utf8");
		const waits: Promise<GitStatus>[] = [];
		for (let index = 0; index < 10; index += 1) {
			waits.push(service.status(root));
			await new Promise((resolve) => setTimeout(resolve, 20));
		}
		const results = await Promise.all(waits);

		expect(rounds).toBeLessThanOrEqual(2);
		// 所有等待者拿到的都是同一份最新结果
		expect(results.every((status) => status.files.length === 1)).toBe(true);
	});

	it("不同仓库各排各的，不会被对方的冷却挡住", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({
			cooldownMs: 5000,
			resolveKey: sameKey,
			probeStatus: stub.probe,
		});

		await Promise.all([service.status("/a"), service.status("/b")]);
		expect(stub.calls).toBe(2);
	});

	it("探测失败时等待者都收到同一个错误，之后还能再跑", async () => {
		let calls = 0;
		const service = new GitRefreshService({
			cooldownMs: 20,
			resolveKey: sameKey,
			probeStatus: async () => {
				calls += 1;
				if (calls === 1) {
					throw new Error("git 挂了");
				}
				return statusOf(`run-${calls}`);
			},
		});

		await expect(service.status("/repo")).rejects.toThrow("git 挂了");
		const recovered = await service.status("/repo", { force: true });
		expect(recovered.branch).toBe("run-2");
	});
});
