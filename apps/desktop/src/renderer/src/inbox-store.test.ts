import { describe, expect, it } from "vitest";
import {
	purgeOfflineEndpoint,
	readOfflineCache,
	readSettledMap,
	syncOfflineEndpoint,
	writeOfflineCache,
	writeSettledMap,
} from "./inbox-store.ts";
import type { ScopedStorage } from "./local-storage.ts";

function memoryStorage(): ScopedStorage {
	const data = new Map<string, string>();
	return {
		getItem: (key) => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value);
		},
		removeItem: (key) => {
			data.delete(key);
		},
	};
}

describe("inbox-store", () => {
	it("读写 Settle 归档映射与离线缓存并支持按主机清理", () => {
		const storage = memoryStorage();
		writeSettledMap(storage, { "local::/a.jsonl": 1000 });
		expect(readSettledMap(storage)).toEqual({ "local::/a.jsonl": 1000 });

		const synced = syncOfflineEndpoint(
			{},
			{
				endpoint: "ssh://laptop",
				hostLabel: "laptop",
				settled: {},
				untitled: "Untitled",
				sessions: [
					{
						id: "1",
						path: "/srv/s1.jsonl",
						cwd: "/srv/facet",
						name: undefined,
						parentSessionPath: undefined,
						created: 1,
						modified: 200,
						firstMessage: "远端任务",
					},
					{
						id: "empty",
						path: "/srv/empty.jsonl",
						cwd: "/srv/facet",
						name: undefined,
						parentSessionPath: undefined,
						created: 1,
						modified: 200,
						firstMessage: "",
					},
				],
			},
		);
		writeOfflineCache(storage, synced);
		const reloaded = readOfflineCache(storage);
		expect(Object.keys(reloaded)).toEqual(["ssh://laptop::/srv/s1.jsonl"]);
		expect(reloaded["ssh://laptop::/srv/s1.jsonl"]?.projectName).toBe("facet");

		expect(purgeOfflineEndpoint(reloaded, "ssh://laptop")).toEqual({});
	});
});
