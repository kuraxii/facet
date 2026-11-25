/**
 * 静默回收在客户端这一层的行为。
 *
 * 重点是衔接：裁掉的那段重新往上翻必须一模一样地取回来——顺序、条目、条数都不许有偏差，
 * 否则用户看到的是一段被悄悄改过的历史。
 */
import type { Channel, Entry, Message, RequestMethod, RequestParams, RequestResults } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import type { HostHandshake, SessionTransport } from "./client.ts";
import { SessionClient } from "./client.ts";
import { sessionSnapshot } from "./session-fixture.test-support.ts";

const handshake: HostHandshake = {
	protocolVersion: 1,
	hostId: "h",
	hostName: "主机",
	clientId: "c",
	role: "admin",
	canManage: true,
	capabilities: ["dispatch"],
};

/** 用户消息。 */
function user(text: string): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1 };
}

/** 助手消息。 */
function assistant(text: string): Message {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		provider: "p",
		model: "m",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			reasoning: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

/** 只认 entries 分页的假主机：条目用户与助手交替，游标就是条目 id。 */
class PagingTransport implements SessionTransport {
	readonly entries: Entry[];

	constructor(count: number) {
		this.entries = Array.from({ length: count }, (_, index) => ({
			id: `e${index + 1}`,
			parentId: index === 0 ? null : `e${index}`,
			kind: "message" as const,
			timestamp: "2026-11-19T00:00:00Z",
			// 偶数位是用户消息：每一轮两条，裁剪点必然落在它们上面
			message: index % 2 === 0 ? user(`第 ${index + 1} 问`) : assistant(`第 ${index + 1} 答`),
		}));
	}

	async request<M extends RequestMethod>(method: M, params?: RequestParams[M]): Promise<RequestResults[M]> {
		const result = (() => {
			switch (method) {
				case "openSession":
					return sessionSnapshot();
				case "subscribe": {
					const channel = (params as { channel: Channel }).channel;
					return {
						seq: 0,
						resync: false,
						session: channel.startsWith("session:") ? sessionSnapshot() : undefined,
					};
				}
				case "entries": {
					const { cursor, limit } = params as { cursor?: string; limit?: number };
					const size = limit ?? 50;
					const end =
						cursor === undefined
							? this.entries.length
							: this.entries.findIndex((entry) => entry.id === cursor);
					const start = Math.max(0, end - size);
					const window = this.entries.slice(start, end);
					const first = window[0];
					return { entries: window, nextCursor: start > 0 && first ? first.id : undefined };
				}
				case "entriesAfter": {
					const { afterEntryId } = params as { afterEntryId?: string };
					const index =
						afterEntryId === undefined ? -1 : this.entries.findIndex((e) => e.id === afterEntryId);
					const leaf = this.entries[this.entries.length - 1];
					return { entries: this.entries.slice(index + 1), leafId: leaf?.id ?? null };
				}
				default:
					return {};
			}
		})();
		return result as RequestResults[M];
	}

	dispatch(): number {
		return 0;
	}

	onAction(): () => void {
		return () => undefined;
	}
}

/** 应用里的真实页大小与首屏页数（`host-runtime.ts` 传的就是这两个数）。 */
const PAGE_SIZE = 200;
const INITIAL_PAGES = 2;

/** 打开一条长会话，并往上翻到 `pages` 页。 */
async function openLong(count: number, pages: number): Promise<{ client: SessionClient; all: string[] }> {
	const transport = new PagingTransport(count);
	const client = new SessionClient({ transport, initialPages: INITIAL_PAGES, pageSize: PAGE_SIZE });
	client.attach(handshake);
	await client.openSession("/tmp/s1.jsonl");
	for (let index = 2; index < pages; index += 1) {
		await client.loadOlder();
	}
	return { client, all: transport.entries.map((entry) => entry.id) };
}

/** 视图里当前的条目 id 序列（去掉历史视图标识的前缀）。 */
function itemIds(client: SessionClient): string[] {
	return (client.chatView()?.items ?? []).map((item) => item.entry?.id ?? item.id);
}

describe("SessionClient.trimOlderHistory", () => {
	it("翻过水位之后裁回首屏基线，游标回退到保留区首条", async () => {
		const { client, all } = await openLong(1200, 4);
		expect(itemIds(client)).toHaveLength(800);
		const cut = client.historyTrimCut();
		expect(cut).toBeDefined();
		const before = itemIds(client);

		const result = client.trimOlderHistory();
		expect(result.trimmed).toBeGreaterThan(0);
		const after = itemIds(client);
		expect(after.length).toBeLessThanOrEqual(client.historyWatermark + 2);
		expect(after.length).toBeGreaterThanOrEqual(client.historyWatermark - 1);
		// 保留区就是原来那段的尾部，一条不差
		expect(after).toEqual(before.slice(before.length - after.length));
		// 裁剪只动更早的那段
		expect(after[after.length - 1]).toBe(all[all.length - 1]);
		// 还有更早的可翻，回底入口不会灰掉
		expect(client.hasMore).toBe(true);
	});

	it("裁完再往上翻，拉回的就是被裁掉的那一段：不重复、不遗漏、顺序一致", async () => {
		const { client, all } = await openLong(1200, 4);
		client.trimOlderHistory();
		const trimmed = itemIds(client);
		const dropped = all.length - trimmed.length;

		await client.loadOlder();
		const grown = itemIds(client);
		// 新补上来的一页紧贴在保留区之前，重复的已存在条目被跳过
		expect(grown.slice(grown.length - trimmed.length)).toEqual(trimmed);
		expect(grown).toEqual(all.slice(all.length - grown.length));

		// 一路翻回去，最终与原始全量完全一致
		for (let index = 0; index < 10 && client.hasMore; index += 1) {
			await client.loadOlder();
		}
		expect(itemIds(client)).toEqual(all);
		expect(client.hasMore).toBe(false);
		expect(trimmed.length).toBeLessThan(all.length);
		expect(dropped).toBeGreaterThan(0);
	});

	it("两次裁剪之间插入一次翻页，衔接处仍然连续", async () => {
		const { client, all } = await openLong(1200, 4);
		client.trimOlderHistory();
		await client.loadOlder();
		client.trimOlderHistory();
		const afterSecond = itemIds(client);
		expect(afterSecond).toEqual(all.slice(all.length - afterSecond.length));
		await client.loadOlder();
		const grown = itemIds(client);
		expect(grown).toEqual(all.slice(all.length - grown.length));
	});

	it("正好落在水位上时不动", async () => {
		const { client } = await openLong(400, 2);
		expect(client.historyTrimCut()).toBeUndefined();
		expect(client.trimOlderHistory()).toEqual({ trimmed: 0 });
		expect(itemIds(client)).toHaveLength(400);
	});

	it("没有打开的会话时安全返回", () => {
		const client = new SessionClient({
			transport: new PagingTransport(10),
			initialPages: INITIAL_PAGES,
			pageSize: PAGE_SIZE,
		});
		expect(client.historyTrimCut()).toBeUndefined();
		expect(client.trimOlderHistory()).toEqual({ trimmed: 0 });
	});
});
