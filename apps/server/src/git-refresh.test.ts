/**
 * 仓库级调度的测试。
 *
 * 覆盖冷却、合并方式（latest-wins 取代在途 / single-flight 搭车）、`force` 与失败恢复。
 * 探针换成计数用的假实现，所以断言的是「拉起了几次探测」「那一批有没有被真的收掉」，与
 * 真实 git 无关；`resolveKey` 也换成恒等函数，省掉每条用例去 spawn 一次 rev-parse。
 */
import type { GitCommitDetail, GitCommits, GitDiff, GitStatus } from "@facet/protocol";
import { describe, expect, it, vi } from "vitest";
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

	it("连着的 10 次请求只跑一两轮探测", async () => {
		const stub = probeStub();
		const service = new GitRefreshService({ resolveKey: sameKey, probeStatus: stub.probe });

		/*
		 * 间隔 15ms、总共 150ms，落在 1500ms 的冷却窗口里，探测本身又是同步返回的：
		 * 这串请求该被并成一批，冷却到点只再多跑一轮。
		 *
		 * 不拿真仓库来定这个间隔：工作区车道走 latest-wins，请求打得比一轮探测还密就会
		 * 一直「新一代顶掉在途」（那是车道的既定行为），而 `git status` 在不同机器上差一个
		 * 量级——本机 Windows 二百多毫秒、Linux 几十毫秒——真仓库上「最多两轮」只在快的
		 * 那边成立。这里要验的是调度，探测本身另有用例覆盖。
		 */
		const waits: Promise<GitStatus>[] = [];
		for (let index = 0; index < 10; index += 1) {
			waits.push(service.status("/repo"));
			await new Promise((resolve) => setTimeout(resolve, 15));
		}
		const results = await Promise.all(waits);

		// 十次请求只跑了两轮：第一轮服务第一个请求，其余九个在冷却窗口里并成一批，等第二轮
		expect(stub.calls).toBe(2);
		expect(results[0]?.branch).toBe("run-1");
		expect(results.slice(1).every((status) => status.branch === "run-2")).toBe(true);
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
