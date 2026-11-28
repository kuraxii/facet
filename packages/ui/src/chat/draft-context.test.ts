import { describe, expect, it } from "vitest";
import {
	type DraftContextStore,
	pushRecentDraftContext,
	readDraftContextStore,
	updateEndpointDraftMemory,
	writeDraftContextStore,
} from "./draft-context.ts";

describe("draft-context", () => {
	it("按端点记住草稿参数并往返读写存储", () => {
		const bag = new Map<string, string>();
		const storage = {
			getItem: (k: string) => bag.get(k) ?? null,
			setItem: (k: string, v: string) => void bag.set(k, v),
		};

		let store = readDraftContextStore(storage);
		store = updateEndpointDraftMemory(store, "local", {
			cwd: "/work/facet",
			agentId: "pi",
			modelProvider: "openai",
			modelId: "gpt-5",
			thinkingLevel: "high",
		});
		store = updateEndpointDraftMemory(store, "ssh://laptop", { cwd: "/srv/app", agentId: "codex" });
		writeDraftContextStore(storage, store);

		const restored = readDraftContextStore(storage);
		expect(restored.byEndpoint.local?.cwd).toBe("/work/facet");
		expect(restored.byEndpoint.local?.modelId).toBe("gpt-5");
		expect(restored.byEndpoint["ssh://laptop"]?.agentId).toBe("codex");
	});

	it("最近上下文按组合去重并只保留最近 3 条", () => {
		let store: DraftContextStore = { byEndpoint: {}, recent: [] };
		store = pushRecentDraftContext(store, {
			endpoint: "local",
			hostLabel: "This computer",
			cwd: "/a",
			agentId: "pi",
			updatedAt: 1,
		});
		store = pushRecentDraftContext(store, {
			endpoint: "local",
			hostLabel: "This computer",
			cwd: "/b",
			agentId: "pi",
			updatedAt: 2,
		});
		store = pushRecentDraftContext(store, {
			endpoint: "ssh://box",
			hostLabel: "box",
			cwd: "/c",
			agentId: "codex",
			updatedAt: 3,
		});
		store = pushRecentDraftContext(store, {
			endpoint: "local",
			hostLabel: "This computer",
			cwd: "/a",
			agentId: "pi",
			updatedAt: 4,
		});
		store = pushRecentDraftContext(store, {
			endpoint: "local",
			hostLabel: "This computer",
			cwd: "/d",
			agentId: "pi",
			updatedAt: 5,
		});

		expect(store.recent).toHaveLength(3);
		expect(store.recent.map((item) => item.cwd)).toEqual(["/d", "/a", "/c"]);
	});
});
