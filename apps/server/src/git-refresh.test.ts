/**
 * 仓库级刷新调度的测试。
 *
 * 覆盖单飞、冷却、尾随合并、并发共享结果与 `force`；探针换成计数用的假实现，所以断言的是
 * 「拉起了几次探测」，与真实 git 无关。
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitCommits, GitStatus } from "@facet/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { gitStatus } from "./git.ts";
import { GitRefreshService } from "./git-refresh.ts";

/** 一次探测的结果，内容不重要，只用来比对是不是同一份。 */
function statusOf(tag: string): GitStatus {
	return { isRepo: true, branch: tag, files: [] };
}

/**
 * 假探针：记下调用次数，每次给一个带序号的结果。
 *
 * `hold` 不为空时探测挂起，由用例决定何时放行，用来摆出「正在跑」的局面。
 */
function probeStub() {
	let calls = 0;
	let release: (() => void) | undefined;
	const probe = async (): Promise<GitStatus> => {
		calls += 1;
		const tag = `run-${calls}`;
		if (release !== undefined) {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		}
		return statusOf(tag);
	};
	return {
		probe,
		get calls(): number {
			return calls;
		},
		/** 让下一次探测挂住，直到 `let_go()`。 */
		hold(): void {
			release = () => undefined;
		},
		let_go(): void {
			const resume = release;
			release = undefined;
			resume?.();
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

describe("GitRefreshService", () => {
	it("提交历史有自己的单飞：并发请求最多两轮", async () => {
		const stub = commitsStub();
		const service = new GitRefreshService({ commitsCooldownMs: 40, probeCommits: stub.probe });

		const results = await Promise.all(Array.from({ length: 10 }, async () => await service.commits("/repo")));

		expect(stub.calls).toBe(2);
		expect(new Set(results.map((result) => result.commits[0]?.sha))).toEqual(new Set(["sha-1", "sha-2"]));
	});

	it("状态与提交历史各排各的，互不吃对方的冷却", async () => {
		const status = probeStub();
		const commits = commitsStub();
		const service = new GitRefreshService({
			cooldownMs: 5000,
			commitsCooldownMs: 5000,
			probeStatus: status.probe,
			probeCommits: commits.probe,
		});

		await service.status("/repo");
		// 状态刚跑完、正在冷却，提交历史照样立刻能跑
		await service.commits("/repo");
		expect(status.calls).toBe(1);
		expect(commits.calls).toBe(1);
	});

	it("force 跳过提交历史的冷却", async () => {
		const stub = commitsStub();
		const service = new GitRefreshService({ commitsCooldownMs: 5000, probeCommits: stub.probe });

		await service.commits("/repo");
		const forced = await service.commits("/repo", { force: true });
		expect(stub.calls).toBe(2);
		expect(forced.commits[0]?.sha).toBe("sha-2");
	});

	it("200ms 里连着来 10 次请求，真仓库上最多跑两轮探测", async () => {
		const root = await createRepo();
		let rounds = 0;
		const service = new GitRefreshService({
			probeStatus: async (repoRoot: string) => {
				rounds += 1;
				return await gitStatus(repoRoot);
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

	it("并发请求只拉起两次探测：首轮加一次冷却后的尾随", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({ cooldownMs: 40, probeStatus: stub.probe });

		const results = await Promise.all(Array.from({ length: 10 }, async () => await service.status("/repo")));

		expect(stub.calls).toBe(2);
		// 后 9 个等的是同一份尾随结果
		expect(new Set(results.map((status) => status.branch))).toEqual(new Set(["run-1", "run-2"]));
	});

	it("冷却窗口里的请求等到冷却结束才跑", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({ cooldownMs: 120, probeStatus: stub.probe });

		await service.status("/repo");
		expect(stub.calls).toBe(1);

		const pending = service.status("/repo");
		await new Promise((resolve) => setTimeout(resolve, 40));
		// 冷却还没走完，不该拉起新探测
		expect(stub.calls).toBe(1);
		await pending;
		expect(stub.calls).toBe(2);
	});

	it("force 跳过冷却，立刻再跑一次", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({ cooldownMs: 5000, probeStatus: stub.probe });

		await service.status("/repo");
		const forced = await service.status("/repo", { force: true });
		expect(stub.calls).toBe(2);
		expect(forced.branch).toBe("run-2");
	});

	it("正在跑时来的 force 排到这一轮结束后立刻跑", async () => {
		const stub = probeStub();
		stub.hold();
		const service = new GitRefreshService({ cooldownMs: 5000, probeStatus: stub.probe });

		const first = service.status("/repo");
		await vi.waitFor(() => expect(stub.calls).toBe(1));
		const forced = service.status("/repo", { force: true });
		stub.let_go();
		await first;
		expect(stub.calls).toBe(1);
		await vi.waitFor(() => expect(stub.calls).toBe(2), { timeout: 2000, interval: 10 });
		expect((await forced).branch).toBe("run-2");
	});

	it("不同仓库各排各的，不会被对方的冷却挡住", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({ cooldownMs: 5000, probeStatus: stub.probe });

		await Promise.all([service.status("/a"), service.status("/b")]);
		expect(stub.calls).toBe(2);
	});

	it("探测失败时等待者都收到同一个错误，之后还能再跑", async () => {
		let calls = 0;
		const service = new GitRefreshService({
			cooldownMs: 20,
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
