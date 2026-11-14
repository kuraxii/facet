import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiAgentFactory } from "@facet/agent";
import type { UiPrompt } from "@facet/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionClient } from "../../../packages/client-core/src/client.ts";
import { StreamTransport } from "../../../packages/transport/src/stream.ts";
import type { StreamLike } from "../../../packages/transport/src/types.ts";
import type { ServerConfig } from "./config.ts";
import { startEndpoint } from "./endpoint.ts";
import { ProjectStore } from "./project-store.ts";
import { SessionHub } from "./session-hub.ts";
import { SessionsChannel } from "./sessions-channel.ts";
import { SettingsStore } from "./settings-store.ts";

let dir: string;
let factory: PiAgentFactory | undefined;
let hub: SessionHub;
let endpoint: Awaited<ReturnType<typeof startEndpoint>> | undefined;
const peers: { client: SessionClient; transport: StreamTransport }[] = [];

/** 把会话条目写成 JSONL；最后一行同样以换行结束。 */
function jsonl(entries: readonly unknown[]): string {
	return `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

async function start(source: string): Promise<void> {
	const agentDir = join(dir, "agent");
	await mkdir(join(agentDir, "extensions"), { recursive: true });
	await writeFile(join(agentDir, "extensions", "probe.ts"), `export default (pi) => { ${source} };`);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	factory = await PiAgentFactory.create({ agentDir });
	hub = new SessionHub({ factory, replayLimit: 8, idleCloseMs: 60_000 });
	const config: ServerConfig = {
		host: "127.0.0.1",
		port: 0,
		socketPath: join(dir, "server.sock"),
		token: undefined,
		remotePermission: "operate",
		webPort: undefined,
		webRoot: undefined,
		agentDir,
		sessionDir: undefined,
		dataDir: dir,
		replayLimit: 8,
		sessionIdleMs: 60_000,
		hostName: "交互测试",
		debug: false,
	};
	endpoint = await startEndpoint({
		config,
		factory,
		hub,
		hostId: "ui-host",
		sessions: new SessionsChannel(8),
		projectStore: await ProjectStore.open({ file: join(dir, "projects.json") }),
		settingsStore: await SettingsStore.open({ file: join(dir, "settings.json") }),
	});
}

async function openPeer(role?: "operator" | "viewer") {
	const transport = new StreamTransport({
		...(role === undefined ? {} : { role }),
		createStream: async (): Promise<StreamLike> => {
			const socket = connect({ path: join(dir, "server.sock") });
			socket.setEncoding("utf8");
			await new Promise<void>((resolve, reject) => {
				socket.once("connect", resolve);
				socket.once("error", reject);
			});
			return {
				write: (text) => {
					socket.write(text);
				},
				onData: (listener) => {
					socket.on("data", listener);
					return () => {
						socket.off("data", listener);
					};
				},
				onClose: (listener) => {
					const closed = () => listener("连接关闭");
					socket.on("close", closed);
					return () => {
						socket.off("close", closed);
					};
				},
				close: () => {
					socket.destroy();
				},
			};
		},
	});
	const handshake = await transport.connect();
	const client = new SessionClient({ transport });
	client.attach(handshake);
	peers.push({ client, transport });
	return { client, transport, handshake };
}

async function prompt(client: SessionClient, kind: UiPrompt["kind"]): Promise<UiPrompt> {
	await vi.waitFor(() => expect(client.sessionView()?.state.extensionUi.prompts[0]?.kind).toBe(kind));
	const pending = client.sessionView()?.state.extensionUi.prompts[0];
	if (pending === undefined) throw new Error("没有待答请求");
	return pending;
}

async function ready(client: SessionClient): Promise<void> {
	await vi.waitFor(() => expect(client.sessionView()?.state.initialization.kind).toBe("ready"));
}

beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "facet-extension-ui-"));
});

afterEach(async () => {
	for (const { client, transport } of peers.splice(0)) {
		client.dispose();
		transport.close();
	}
	await endpoint?.close();
	endpoint = undefined;
	hub?.dispose();
	factory?.dispose();
	factory = undefined;
	vi.unstubAllEnvs();
	await rm(dir, { recursive: true, force: true });
});

describe("pi 扩展交互完整链路", () => {
	it("session_start 等待交互时新建、订阅与应答均可返回", async () => {
		await start(`pi.on("session_start", async (_, ctx) => {
			const value = await ctx.ui.input("启动输入", "名称");
			ctx.ui.notify("启动内容：" + value);
		});`);
		const { client, handshake } = await openPeer();
		expect(handshake.capabilities).toContain("extensionUi");
		await client.createSession({ cwd: dir });
		expect(client.sessionView()?.state.initialization.kind).toBe("starting");
		const pending = await prompt(client, "input");
		expect(await client.respondUi(pending.requestId, { kind: "input", value: "项目名称" })).toBe(true);
		await ready(client);
		expect(client.sessionView()?.state.extensionUi.notices).toEqual([
			expect.objectContaining({ message: "启动内容：项目名称" }),
		]);
	});

	it("扩展命令依次完成四种交互、草稿写入与发送确认，内容不写入 JSONL", async () => {
		await start(`pi.registerCommand("bridge", { handler: async (_, ctx) => {
			if (!await ctx.ui.confirm("确认", "继续？")) return;
			const selected = await ctx.ui.select("选择", ["A", "B"]);
			const text = await ctx.ui.input("输入");
			const edited = await ctx.ui.editor("编辑", "  完整内容\\n\\n末行  ");
			ctx.ui.setEditorText(edited);
			ctx.ui.notify(selected + ":" + text);
		} });`);
		const { client } = await openPeer();
		const opened = await client.createSession({ cwd: dir });
		await ready(client);
		const sent = vi.fn();
		client.onSent(sent);
		client.send("/bridge");
		let pending = await prompt(client, "confirm");
		await client.respondUi(pending.requestId, { kind: "confirm", confirmed: true });
		pending = await prompt(client, "select");
		await client.respondUi(pending.requestId, { kind: "select", value: "B" });
		pending = await prompt(client, "input");
		await client.respondUi(pending.requestId, { kind: "input", value: "private-78421" });
		pending = await prompt(client, "editor");
		expect(pending).toMatchObject({ prefill: "  完整内容\n\n末行  " });
		await client.respondUi(pending.requestId, { kind: "editor", value: "  编辑内容\n\n末行  " });
		await vi.waitFor(() => expect(sent).toHaveBeenCalledWith("/bridge"));
		expect(client.sessionView()?.state.extensionUi.editor?.text).toBe("  编辑内容\n\n末行  ");
		expect(client.sessionView()?.state.extensionUi.prompts).toEqual([]);
		const persisted = await readFile(opened.file ?? "", "utf8").catch((error: NodeJS.ErrnoException) => {
			if (error.code === "ENOENT") return "";
			throw error;
		});
		expect(persisted).not.toContain("private-78421");
		expect(JSON.stringify(hub.agent(opened.sessionId).entryPage(undefined, 100))).not.toContain(
			"private-78421",
		);
	});

	it("operator 与 admin 的第一份有效应答生效，viewer 仅能读取", async () => {
		await start(
			`pi.registerCommand("ask", { handler: async (_, ctx) => { await ctx.ui.input("多端输入"); } });`,
		);
		const first = await openPeer();
		const opened = await first.client.createSession({ cwd: dir });
		await ready(first.client);
		const second = await openPeer("operator");
		const viewer = await openPeer("viewer");
		expect(second.handshake.role).toBe("operator");
		await second.client.openSession(opened.file ?? "");
		await viewer.client.openSession(opened.file ?? "");
		first.client.send("/ask");
		const pending = await prompt(first.client, "input");
		await prompt(second.client, "input");
		await prompt(viewer.client, "input");
		await expect(
			viewer.client.respondUi(pending.requestId, { kind: "input", value: "viewer-private" }),
		).rejects.toThrow("只读");
		const results = await Promise.all([
			first.client.respondUi(pending.requestId, { kind: "input", value: "admin-private" }),
			second.client.respondUi(pending.requestId, { kind: "input", value: "operator-private" }),
		]);
		expect(results.sort()).toEqual([false, true]);
		await vi.waitFor(() => expect(viewer.client.sessionView()?.state.extensionUi.prompts).toEqual([]));
		await expect(first.client.respondUi(pending.requestId, { kind: "cancel" })).resolves.toBe(false);
		const audit = await readFile(join(dir, "audit.log"), "utf8");
		expect(audit).toContain("respondUi");
		expect(audit).not.toMatch(/viewer-private|admin-private|operator-private/);
	});

	it("断线保留请求，重连快照恢复并关闭其他端的弹窗", async () => {
		await start(
			`pi.registerCommand("ask", { handler: async (_, ctx) => { await ctx.ui.input("重连输入"); } });`,
		);
		const first = await openPeer();
		const opened = await first.client.createSession({ cwd: dir });
		await ready(first.client);
		first.client.send("/ask");
		const pending = await prompt(first.client, "input");
		first.transport.close();
		const again = await openPeer();
		await again.client.openSession(opened.file ?? "");
		expect(again.client.sessionView()?.state.extensionUi.prompts[0]?.requestId).toBe(pending.requestId);
		await again.client.respondUi(pending.requestId, { kind: "cancel" });
		await first.transport.connect();
		await first.client.resume();
		expect(first.client.sessionView()?.state.extensionUi.prompts).toEqual([]);
	});

	it("停止绕过等待交互的命令队列，后续请求恢复", async () => {
		await start(`pi.registerCommand("ask", { handler: async (_, ctx) => {
			await ctx.ui.input("停止输入");
			await ctx.ui.editor("后续输入");
		} });`);
		const { client } = await openPeer();
		await client.createSession({ cwd: dir });
		await ready(client);
		client.send("/ask");
		const pending = await prompt(client, "input");
		client.cancel();
		await vi.waitFor(() => expect(client.sessionView()?.state.extensionUi.prompts).toEqual([]));
		await vi.waitFor(() => expect(client.sessionView()?.state.phase).toBe("idle"));
		expect(await client.respondUi(pending.requestId, { kind: "cancel" })).toBe(false);
		client.send("/ask");
		await prompt(client, "input");
		client.cancel();
	});

	it("超时由 server 取消并返回 SDK 的空值", async () => {
		await start(`pi.registerCommand("timed", { handler: async (_, ctx) => {
			const value = await ctx.ui.confirm("限时确认", "继续？", { timeout: 250 });
			ctx.ui.notify("确认内容：" + value);
		} });`);
		const { client } = await openPeer();
		await client.createSession({ cwd: dir });
		await ready(client);
		client.send("/timed");
		const pending = await prompt(client, "confirm");
		expect(pending.expiresAt).toBeTypeOf("number");
		await vi.waitFor(() => expect(client.sessionView()?.state.extensionUi.prompts).toEqual([]));
		expect(client.sessionView()?.state.extensionUi.notices).toEqual([
			expect.objectContaining({ message: "确认内容：false" }),
		]);
	});

	it("停止启动询问能够结束初始化，TUI 专属 API 保持 RPC 降级", async () => {
		await start(`pi.on("session_start", async (_, ctx) => {
			ctx.ui.notify("mode:" + ctx.mode);
			await ctx.ui.custom(() => { throw new Error("不得调用 TUI 工厂"); });
			ctx.ui.setWidget("probe", () => { throw new Error("不得调用组件工厂"); });
			ctx.ui.notify("draft:" + ctx.ui.getEditorText());
			await ctx.ui.input("启动输入");
		});`);
		const { client } = await openPeer();
		await client.createSession({ cwd: dir });
		await prompt(client, "input");
		client.cancel();
		await ready(client);
		expect(client.sessionView()?.state.extensionUi.notices?.map((notice) => notice.message)).toEqual([
			"mode:rpc",
			"draft:",
		]);
	});

	it("已有会话打开与分叉都能在 session_start 中等待交互", async () => {
		await start(`pi.on("session_start", async (_, ctx) => { await ctx.ui.input("启动输入"); });`);
		const file = join(dir, "history.jsonl");
		const timestamp = new Date().toISOString();
		await writeFile(
			file,
			jsonl([
				{ type: "session", version: 3, id: "history-s1", timestamp, cwd: dir },
				{
					type: "message",
					id: "e1",
					parentId: null,
					timestamp,
					message: { role: "user", content: "已有内容", timestamp: Date.now() },
				},
			]),
		);
		const { client } = await openPeer();
		await client.openSession(file);
		let pending = await prompt(client, "input");
		await client.respondUi(pending.requestId, { kind: "cancel" });
		await ready(client);
		const forked = await client.fork();
		expect(forked.sessionId).not.toBe("history-s1");
		pending = await prompt(client, "input");
		await client.respondUi(pending.requestId, { kind: "input", value: "分叉内容" });
		await ready(client);
	});

	it("并行请求按发起顺序同步，后续请求不覆盖较早请求", async () => {
		await start(`pi.registerCommand("parallel", { handler: async (_, ctx) => {
			await Promise.all([ctx.ui.input("第一项"), ctx.ui.confirm("第二项", "内容")]);
		} });`);
		const { client } = await openPeer();
		await client.createSession({ cwd: dir });
		await ready(client);
		client.send("/parallel");
		const first = await prompt(client, "input");
		const prompts = client.sessionView()?.state.extensionUi.prompts ?? [];
		expect(prompts.map((item) => item.title)).toEqual(["第一项", "第二项"]);
		await client.respondUi(first.requestId, { kind: "cancel" });
		const second = await prompt(client, "confirm");
		await client.respondUi(second.requestId, { kind: "confirm", confirmed: false });
		await vi.waitFor(() => expect(client.sessionView()?.state.extensionUi.prompts).toEqual([]));
	});

	it("非法应答不会消费请求，AbortSignal 可以结束等待", async () => {
		await start(`pi.registerCommand("abortable", { handler: async (_, ctx) => {
			const controller = new AbortController();
			setTimeout(() => controller.abort(), 400);
			await ctx.ui.input("可中止输入", undefined, { signal: controller.signal });
		} });`);
		const { client, transport } = await openPeer();
		const opened = await client.createSession({ cwd: dir });
		await ready(client);
		client.send("/abortable");
		const pending = await prompt(client, "input");
		await expect(
			transport.request("respondUi", {
				sessionId: opened.sessionId,
				requestId: pending.requestId,
				response: { kind: "confirm", confirmed: "true" },
			} as never),
		).rejects.toThrow("boolean");
		await expect(client.respondUi(pending.requestId, { kind: "confirm", confirmed: true })).rejects.toThrow(
			"类型",
		);
		expect(client.sessionView()?.state.extensionUi.prompts[0]?.requestId).toBe(pending.requestId);
		await vi.waitFor(() => expect(client.sessionView()?.state.extensionUi.prompts).toEqual([]));
	});

	it("压缩期间的确认独立于 maintenance，并能完成扩展提供的摘要", async () => {
		await start(`pi.on("session_before_compact", async (event, ctx) => {
			if (!await ctx.ui.confirm("摘要内容", "继续生成？", { signal: event.signal })) return { cancel: true };
			return { compaction: { summary: "完整摘要", firstKeptEntryId: event.preparation.firstKeptEntryId, tokensBefore: event.preparation.tokensBefore } };
		});`);
		await writeFile(
			join(dir, "agent", "settings.json"),
			JSON.stringify({ compaction: { keepRecentTokens: 32, reserveTokens: 64 } }),
		);
		const model = factory?.models()[0];
		if (model === undefined) throw new Error("没有模型定义");
		const file = join(dir, "compaction.jsonl");
		const timestamp = new Date().toISOString();
		await writeFile(
			file,
			jsonl([
				{ type: "session", version: 3, id: "compaction-s1", timestamp, cwd: dir },
				{
					type: "model_change",
					id: "model",
					parentId: null,
					timestamp,
					provider: model.provider,
					modelId: model.id,
				},
				...Array.from({ length: 4 }, (_, index) => ({
					type: "message",
					id: `e${index}`,
					parentId: index === 0 ? "model" : `e${index - 1}`,
					timestamp,
					message: {
						role: "user",
						content: `第 ${index} 轮${"context ".repeat(512)}`,
						timestamp: Date.now(),
					},
				})),
			]),
		);
		const { client } = await openPeer();
		await client.openSession(file);
		await ready(client);
		client.compact();
		const pending = await prompt(client, "confirm");
		expect(client.sessionView()?.state.maintenance?.kind).toBe("compaction");
		await client.respondUi(pending.requestId, { kind: "confirm", confirmed: true });
		await vi.waitFor(() => expect(client.sessionView()?.state.maintenance).toBeUndefined());
		expect(hub.agent("compaction-s1").entryPage(undefined, 100).entries.at(-1)).toMatchObject({
			kind: "compaction",
			summary: "完整摘要",
		});
	});

	it("释放会话解除仍在等待应答的串行操作", async () => {
		await start(
			`pi.registerCommand("ask", { handler: async (_, ctx) => { await ctx.ui.input("释放输入"); } });`,
		);
		const { client } = await openPeer();
		const opened = await client.createSession({ cwd: dir });
		await ready(client);
		client.send("/ask");
		await prompt(client, "input");
		hub.release(opened.sessionId);
		await vi.waitFor(() => expect(hub.has(opened.sessionId)).toBe(false));
	});
});
