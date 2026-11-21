/**
 * git 执行适配层的测试。
 *
 * 三件事分开验：
 *
 * - **参数与环境**：拿假 runner 记账，断言只读通道的首位是 `--no-optional-locks`、环境里关掉
 *   了可选锁与交互式凭据，而写入通道两者都没有；用户自己的 `PATH` 之类照传；
 * - **串行与重试**：同一仓库的写操作窗口不重叠，撞上 `index.lock` 时短退避重试、用尽之后抛
 *   可识别的锁冲突；
 * - **取消与上限**：真跑 git，断言中止、超时与输出超限各自给出可识别的错误。
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	createGitExec,
	GIT_COMMIT_TIMEOUT_MS,
	GitAbortedError,
	type GitInvocation,
	GitLockedError,
	GitOutputLimitError,
	type GitProcessResult,
	type GitRunOptions,
	GitTimeoutError,
	gitExec,
} from "./git-exec.ts";

/** 一次调用跑成功。 */
function ok(stdout = ""): GitProcessResult {
	return { code: 0, stdout, stderr: "", stopped: null };
}

/** 一次调用以某个退出码失败。 */
function failed(code: number, stderr: string): GitProcessResult {
	return { code, stdout: "", stderr, stopped: null };
}

/** 记账用的假 runner：每次调用都记下来，结果由脚本给。 */
function fakeRunner(
	script: (
		invocation: GitInvocation,
		options: GitRunOptions,
		call: number,
	) => GitProcessResult | Promise<GitProcessResult>,
): {
	runner: { run: (invocation: GitInvocation, options: GitRunOptions) => Promise<GitProcessResult> };
	calls: { invocation: GitInvocation; options: GitRunOptions }[];
} {
	const calls: { invocation: GitInvocation; options: GitRunOptions }[] = [];
	return {
		calls,
		runner: {
			run: async (invocation, options) => {
				calls.push({ invocation, options });
				return await script(invocation, options, calls.length);
			},
		},
	};
}

/** 等一会儿。 */
function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

describe("只读通道", () => {
	it("首位是 --no-optional-locks,环境里关掉可选锁与交互提示", async () => {
		const fake = fakeRunner(() => ok());
		const exec = createGitExec({ runner: fake.runner });

		await exec.runRead("/repo", ["status", "--porcelain=v2", "-z"]);
		const call = fake.calls[0];
		expect(call).toBeDefined();
		if (call === undefined) {
			throw new Error("没有派出子进程");
		}

		// 全局选项必须在子命令之前，`--no-optional-locks` 还要在最前面
		expect(call.invocation.args.slice(0, 6)).toEqual([
			"--no-optional-locks",
			"-c",
			"core.quotepath=false",
			"-C",
			"/repo",
			"--no-pager",
		]);
		expect(call.invocation.args.slice(6)).toEqual(["status", "--porcelain=v2", "-z"]);
		expect(call.invocation.env.GIT_TERMINAL_PROMPT).toBe("0");
		expect(call.invocation.env.GCM_INTERACTIVE).toBe("never");
		expect(call.invocation.env.GIT_OPTIONAL_LOCKS).toBe("0");
		// 只读把整份 LC_ALL 钉成 C：报错固定英文，解析与判定不跟着系统语言变
		expect(call.invocation.env.LC_ALL).toBe("C");
		expect(call.invocation.env.LC_MESSAGES).toBe(process.env.LC_MESSAGES);
		// 用户的环境不能被清空：SSH 与 GPG 签名都靠它
		expect(call.invocation.env.PATH).toBe(process.env.PATH);
		expect(call.options.timeoutMs).toBe(15_000);
		expect(call.options.maxBuffer).toBe(8 * 1024 * 1024);
	});

	it("给超时与上限时按给的来", async () => {
		const fake = fakeRunner(() => ok());
		const exec = createGitExec({ runner: fake.runner });

		await exec.runRead("/repo", ["log"], { timeoutMs: 20_000, maxBuffer: 1024 });
		expect(fake.calls[0]?.options.timeoutMs).toBe(20_000);
		expect(fake.calls[0]?.options.maxBuffer).toBe(1024);
	});

	it("流式调用把每段都交出去,到上限就停", async () => {
		const fake = fakeRunner(async (_invocation, options) => {
			const keepGoing = options.onStdout?.("a\u0000b\u0000") !== true;
			return {
				code: keepGoing ? 0 : null,
				stdout: "",
				stderr: "",
				stopped: keepGoing ? null : "limit",
			};
		});
		const exec = createGitExec({ runner: fake.runner });

		const chunks: string[] = [];
		const result = await exec.runReadStreaming("/repo", ["status", "-z"], {
			onStdout: (chunk) => {
				chunks.push(chunk);
				return true;
			},
		});
		expect(chunks).toEqual(["a\u0000b\u0000"]);
		expect(result.stopped).toBe("limit");
	});
});

describe("写入通道", () => {
	it("不加 --no-optional-locks 与 GIT_OPTIONAL_LOCKS,超时按调用方给", async () => {
		const fake = fakeRunner((invocation) => (invocation.args.includes("rev-parse") ? ok("/repo\n") : ok()));
		const exec = createGitExec({ runner: fake.runner });

		await exec.runWrite("/repo/sub", ["add", "--", "a.txt"], { timeoutMs: GIT_COMMIT_TIMEOUT_MS });
		const write = fake.calls.find((call) => call.invocation.args.includes("add"));
		expect(write).toBeDefined();
		if (write === undefined) {
			throw new Error("没有派出写操作");
		}
		expect(write.invocation.args).toEqual([
			"-c",
			"core.quotepath=false",
			"-C",
			"/repo/sub",
			"--no-pager",
			"add",
			"--",
			"a.txt",
		]);
		expect(write.invocation.env.GIT_OPTIONAL_LOCKS).toBeUndefined();
		expect(write.invocation.env.GIT_TERMINAL_PROMPT).toBe("0");
		// 写入只钉消息语言：LC_ALL 留给钩子，别把 LC_CTYPE 压成 ASCII
		expect(write.invocation.env.LC_MESSAGES).toBe("C");
		expect(write.invocation.env.LC_ALL).toBe(process.env.LC_ALL);
		expect(write.invocation.env.LC_CTYPE).toBe(process.env.LC_CTYPE);
		expect(write.options.timeoutMs).toBe(GIT_COMMIT_TIMEOUT_MS);
	});

	it("写入通道把用户的语言环境留给钩子", async () => {
		const previous = process.env.LC_CTYPE;
		process.env.LC_CTYPE = "zh_CN.UTF-8";
		try {
			const fake = fakeRunner((invocation) => (invocation.args.includes("rev-parse") ? ok("/repo\n") : ok()));
			const exec = createGitExec({ runner: fake.runner });
			await exec.runWrite("/repo", ["commit", "-m", "中文说明"]);

			const write = fake.calls.find((call) => call.invocation.args.includes("commit"));
			expect(write).toBeDefined();
			if (write === undefined) {
				throw new Error("没有派出写操作");
			}
			// 消息语言钉住，字符集留给 pre-commit 之类的钩子
			expect(write.invocation.env.LC_MESSAGES).toBe("C");
			expect(write.invocation.env.LC_CTYPE).toBe("zh_CN.UTF-8");
			expect(write.invocation.env.LC_ALL).toBeUndefined();
		} finally {
			if (previous === undefined) {
				delete process.env.LC_CTYPE;
			} else {
				process.env.LC_CTYPE = previous;
			}
		}
	});

	it("同一仓库的写操作严格串行，不会自己撞 index.lock", async () => {
		let active = 0;
		let peak = 0;
		const order: string[] = [];
		const fake = fakeRunner(async (invocation) => {
			if (invocation.args.includes("rev-parse")) {
				return ok("/repo\n");
			}
			active += 1;
			peak = Math.max(peak, active);
			order.push(invocation.args.at(-1) ?? "");
			await wait(10);
			active -= 1;
			return ok();
		});
		const exec = createGitExec({ runner: fake.runner });

		await Promise.all([
			exec.runWrite("/repo", ["add", "a"]),
			exec.runWrite("/repo", ["add", "b"]),
			exec.runWrite("/repo", ["add", "c"]),
		]);
		expect(peak).toBe(1);
		expect(order).toEqual(["a", "b", "c"]);
	});

	it("不同仓库各排各的", async () => {
		let active = 0;
		let peak = 0;
		const fake = fakeRunner(async (invocation) => {
			if (invocation.args.includes("rev-parse")) {
				const cwd = invocation.args[invocation.args.indexOf("-C") + 1] ?? "";
				return ok(`${cwd}\n`);
			}
			active += 1;
			peak = Math.max(peak, active);
			await wait(10);
			active -= 1;
			return ok();
		});
		const exec = createGitExec({ runner: fake.runner });

		await Promise.all([exec.runWrite("/a", ["add", "x"]), exec.runWrite("/b", ["add", "y"])]);
		expect(peak).toBe(2);
	});

	it("撞上 index.lock 时短退避重试", async () => {
		let attempts = 0;
		const fake = fakeRunner((invocation) => {
			if (invocation.args.includes("rev-parse")) {
				return ok("/repo\n");
			}
			attempts += 1;
			return attempts < 3
				? failed(128, "fatal: Unable to create '/repo/.git/index.lock': File exists.")
				: ok();
		});
		const exec = createGitExec({ runner: fake.runner });

		const result = await exec.runWrite("/repo", ["add", "a"]);
		expect(result.code).toBe(0);
		expect(attempts).toBe(3);
	});

	it("重试用尽之后抛出可识别的锁冲突", async () => {
		let attempts = 0;
		const fake = fakeRunner((invocation) => {
			if (invocation.args.includes("rev-parse")) {
				return ok("/repo\n");
			}
			attempts += 1;
			return failed(128, "fatal: Unable to create '/repo/.git/index.lock': File exists.");
		});
		const exec = createGitExec({ runner: fake.runner });

		await expect(exec.runWrite("/repo", ["commit", "-m", "x"])).rejects.toBeInstanceOf(GitLockedError);
		// 首发加两次短退避
		expect(attempts).toBe(3);
	});

	it("别的错误不重试", async () => {
		let attempts = 0;
		const fake = fakeRunner((invocation) => {
			if (invocation.args.includes("rev-parse")) {
				return ok("/repo\n");
			}
			attempts += 1;
			return failed(1, "nothing to commit");
		});
		const exec = createGitExec({ runner: fake.runner });

		const result = await exec.runWrite("/repo", ["commit", "-m", "x"]);
		expect(result.code).toBe(1);
		expect(attempts).toBe(1);
	});
});

describe("仓库根", () => {
	it("按 rev-parse 的结果归一,并缓存住", async () => {
		const fake = fakeRunner(() => ok("/repo\n"));
		const exec = createGitExec({ runner: fake.runner });

		expect(await exec.repoRootOf("/repo/sub")).toBe("/repo");
		expect(await exec.repoRootOf("/repo/sub")).toBe("/repo");
		// 第二下一次不再问 git
		expect(fake.calls).toHaveLength(1);
	});

	it("不是仓库时退回调用方的目录", async () => {
		const fake = fakeRunner(() => failed(128, "fatal: not a git repository"));
		const exec = createGitExec({ runner: fake.runner });

		expect(await exec.repoRootOf("/tmp/nowhere")).toBe("/tmp/nowhere");
	});
});

describe("取消、超时与上限", () => {
	let repo = "";

	beforeAll(async () => {
		repo = await mkdtemp(join(tmpdir(), "facet-git-exec-"));
		const env = {
			...process.env,
			GIT_AUTHOR_NAME: "facet",
			GIT_AUTHOR_EMAIL: "facet@example.com",
			GIT_COMMITTER_NAME: "facet",
			GIT_COMMITTER_EMAIL: "facet@example.com",
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_SYSTEM: "/dev/null",
		};
		execFileSync("git", ["-C", repo, "init", "-b", "main"], { env });
		await writeFile(join(repo, "a.txt"), "一行\n".repeat(200), "utf8");
		execFileSync("git", ["-C", repo, "add", "."], { env });
		execFileSync("git", ["-C", repo, "commit", "-m", "初始提交"], { env });
	});

	afterAll(async () => {
		if (repo.length > 0) {
			await rm(repo, { recursive: true, force: true });
		}
	});

	it("中止时抛 GitAbortedError", async () => {
		// `cat-file --batch` 一直在等 stdin：进程必然还活着，中止一定打断它
		const controller = new AbortController();
		const pending = gitExec.runRead(repo, ["cat-file", "--batch"], {
			signal: controller.signal,
			timeoutMs: 30_000,
		});
		controller.abort();
		await expect(pending).rejects.toBeInstanceOf(GitAbortedError);
	});

	it("超时抛 GitTimeoutError", async () => {
		await expect(gitExec.runRead(repo, ["cat-file", "--batch"], { timeoutMs: 50 })).rejects.toBeInstanceOf(
			GitTimeoutError,
		);
	});

	it("输出超过上限时抛 GitOutputLimitError", async () => {
		await expect(gitExec.runRead(repo, ["log", "--format=%H"], { maxBuffer: 8 })).rejects.toBeInstanceOf(
			GitOutputLimitError,
		);
	});
});
