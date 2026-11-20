/**
 * 工作树通道的测试。
 *
 * 覆盖订阅即盯着目录、变化推给订阅者、多端共用一份监听、最后一个走了就停、目录不在时
 * 不建通道。
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ActionFrame } from "@facet/protocol";
import { workspaceChannelFor } from "@facet/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceService } from "./workspaces.ts";

const roots: string[] = [];
const services: WorkspaceService[] = [];

/** 建一个临时项目目录。 */
async function tempProject(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "facet-workspace-"));
	roots.push(dir);
	return dir;
}

/** 起一份服务，窗口给短一点。 */
function makeService(): WorkspaceService {
	const service = new WorkspaceService({ ignored: new Set(["node_modules", "out"]), debounceMs: 40 });
	services.push(service);
	return service;
}

/** 收帧的订阅者。 */
function sinkOf(frames: ActionFrame[], id = "c1") {
	return { id, send: (frame: ActionFrame) => frames.push(frame) };
}

afterEach(async () => {
	for (const service of services.splice(0)) {
		service.stopAll();
	}
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("WorkspaceService", () => {
	it("订阅之后工作树的变化推成 workspace/changed", async () => {
		const cwd = await tempProject();
		const service = makeService();
		const frames: ActionFrame[] = [];

		const result = await service.subscribe(workspaceChannelFor(cwd), undefined, sinkOf(frames));
		expect(result).toMatchObject({ seq: 0, resync: false });

		await writeFile(join(cwd, "a.ts"), "a");
		await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
		expect(frames[0]?.channel).toBe(workspaceChannelFor(cwd));
		expect(frames[0]?.action).toMatchObject({ type: "workspace/changed" });
	});

	it("目录不是目录或不存在时返回 undefined，不建通道", async () => {
		const service = makeService();
		const frames: ActionFrame[] = [];
		const missing = await service.subscribe(
			workspaceChannelFor("/nonexistent/facet"),
			undefined,
			sinkOf(frames),
		);
		expect(missing).toBeUndefined();
	});

	it("两个端共用一份监听，各自收到同一批变化", async () => {
		const cwd = await tempProject();
		const service = makeService();
		const channel = workspaceChannelFor(cwd);
		const first: ActionFrame[] = [];
		const second: ActionFrame[] = [];

		await service.subscribe(channel, undefined, sinkOf(first, "c1"));
		await service.subscribe(channel, undefined, sinkOf(second, "c2"));
		expect(service.subscriberCount(channel)).toBe(2);

		await writeFile(join(cwd, "a.ts"), "a");
		await vi.waitFor(() => expect(first.length + second.length).toBeGreaterThan(0), {
			timeout: 5000,
			interval: 25,
		});
		await vi.waitFor(() => expect(second.length).toBeGreaterThan(0), { timeout: 5000, interval: 25 });
	});

	it("退掉订阅之后不再推", async () => {
		const cwd = await tempProject();
		const service = makeService();
		const channel = workspaceChannelFor(cwd);
		const frames: ActionFrame[] = [];
		const sink = sinkOf(frames);

		await service.subscribe(channel, undefined, sink);
		service.unsubscribe(channel, sink);
		expect(service.subscriberCount(channel)).toBe(0);

		await writeFile(join(cwd, "a.ts"), "a");
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(frames).toEqual([]);
	});

	it("断开后按 since 续订能拿到缓冲里的动作", async () => {
		const cwd = await tempProject();
		const service = makeService();
		const channel = workspaceChannelFor(cwd);
		const frames: ActionFrame[] = [];

		await service.subscribe(channel, undefined, sinkOf(frames));
		await writeFile(join(cwd, "a.ts"), "a");
		await vi.waitFor(() => expect(frames.length).toBeGreaterThan(0), { timeout: 5000, interval: 25 });

		// 换一条新端从 0 补，缓冲里那一条应当补发出来
		const replayed: ActionFrame[] = [];
		const result = await service.subscribe(channel, 0, sinkOf(replayed, "c2"));
		expect(result?.seq).toBe(frames[0]?.serverSeq);
		expect(replayed.map((frame) => frame.serverSeq)).toEqual([frames[0]?.serverSeq]);
	});
});
