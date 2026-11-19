/**
 * 会话目录的来源校验。
 *
 * 新建会话的 cwd 由端带过来，端可能还握着另一台机器的路径：Windows 的
 * `C:\Program Files\facet` 在 Linux 上是相对路径，拼在数据目录下会凭空建出一个同名目录，
 * 那条路径还会被当成项目登记。主机这一侧必须在交给 pi 之前按自己的磁盘核一遍。
 */
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Connection, RpcContext } from "./rpc/context.ts";
import { sessionHandlers } from "./rpc/handlers/session-handlers.ts";

/** 记下 hub 收到的参数，其余字段这条用例用不到。 */
function makeContext(received: Record<string, unknown>[]): RpcContext {
	const hub = {
		createSession: async (params: Record<string, unknown>) => {
			received.push(params);
			return { sessionId: "s1", file: "/tmp/s1.jsonl" };
		},
	};
	return { hub } as unknown as RpcContext;
}

/** 会话域的这几个处理器不碰连接，给一个空壳就够。 */
const connection = {} as Connection;

/** 取出请求错误的分类码。 */
function codeOf(error: unknown): unknown {
	return (error as { code?: unknown } | undefined)?.code;
}

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "facet-session-cwd-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("createSession 的 cwd", () => {
	it("另一台机器的路径被拒绝，也不会去建目录", async () => {
		const received: Record<string, unknown>[] = [];
		const context = makeContext(received);
		const cwd = "C:\\Program Files\\facet";

		await expect(sessionHandlers.createSession({ cwd }, context, connection)).rejects.toSatisfy(
			(error: unknown) => codeOf(error) === "bad_params",
		);
		expect(received).toEqual([]);
		expect(await readdir(root)).toEqual([]);
	});

	it("不存在的绝对路径被拒绝", async () => {
		const received: Record<string, unknown>[] = [];
		const context = makeContext(received);

		await expect(
			sessionHandlers.createSession({ cwd: join(root, "missing") }, context, connection),
		).rejects.toSatisfy((error: unknown) => codeOf(error) === "rejected");
		expect(received).toEqual([]);
	});

	it("存在的目录交给 hub 的是实际路径", async () => {
		const received: Record<string, unknown>[] = [];
		const context = makeContext(received);

		await sessionHandlers.createSession({ cwd: `${root}/./` }, context, connection);
		expect(received).toHaveLength(1);
		expect(received[0]?.cwd).toBe(root);
	});

	it("没带 cwd 时照旧由主机取默认目录", async () => {
		const received: Record<string, unknown>[] = [];
		const context = makeContext(received);

		await sessionHandlers.createSession({}, context, connection);
		expect(received).toEqual([
			{
				model: undefined,
				thinkingLevel: undefined,
				tools: undefined,
				excludeTools: undefined,
				name: undefined,
			},
		]);
	});
});
