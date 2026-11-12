/**
 * 主机清单的测试。
 *
 * 覆盖地址归一、清单读写与重复判定；连接行为要真机，靠手工验证。
 */
import { describe, expect, it } from "vitest";
import {
	endpointLabel,
	type HostListStorage,
	hasEndpoint,
	normalizeEndpoint,
	readHostList,
	writeHostList,
} from "./host-list.ts";

/** 内存里的本地存储。 */
function createStorage(
	initial: Record<string, string> = {},
): HostListStorage & { data: Record<string, string> } {
	const data = { ...initial };
	return {
		data,
		getItem: (key) => data[key] ?? null,
		setItem: (key, value) => {
			data[key] = value;
		},
	};
}

describe("normalizeEndpoint", () => {
	it("只写 host:port 时补协议与路径", () => {
		expect(normalizeEndpoint("laptop:6767")).toBe("ws://laptop:6767/endpoint");
	});

	it("已经带协议与路径的原样保留", () => {
		expect(normalizeEndpoint("ws://10.0.0.2:8080/endpoint")).toBe("ws://10.0.0.2:8080/endpoint");
	});

	it("http 换成 ws，https 换成 wss", () => {
		expect(normalizeEndpoint("http://h:1/endpoint")).toBe("ws://h:1/endpoint");
		expect(normalizeEndpoint("https://h:1/endpoint")).toBe("wss://h:1/endpoint");
	});

	it("空串、非 ASCII 与不认识的协议给 undefined", () => {
		expect(normalizeEndpoint("   ")).toBeUndefined();
		expect(normalizeEndpoint("不是地址")).toBeUndefined();
		expect(normalizeEndpoint("ftp://h:1")).toBeUndefined();
	});

	it("没写端口的也当填错", () => {
		expect(normalizeEndpoint("/tmp/whatever")).toBeUndefined();
		expect(normalizeEndpoint("ws://laptop/endpoint")).toBeUndefined();
	});
});

describe("endpointLabel", () => {
	it("只留 host:port", () => {
		expect(endpointLabel("ws://laptop:6767/endpoint")).toBe("laptop:6767");
		expect(endpointLabel("乱写的")).toBe("乱写的");
	});
});

describe("清单读写", () => {
	it("没有记录时用给的端点当默认", () => {
		expect(readHostList(createStorage(), "ws://127.0.0.1:1/endpoint")).toEqual({
			hosts: [],
			activeEndpoint: "ws://127.0.0.1:1/endpoint",
		});
	});

	it("写进去能读回来，坏条目跳过", () => {
		const storage = createStorage();
		writeHostList(storage, {
			hosts: [{ id: "a", name: "laptop", endpoint: "ws://laptop:6767/endpoint" }],
			activeEndpoint: "ws://laptop:6767/endpoint",
		});
		expect(readHostList(storage, "ws://127.0.0.1:1/endpoint")).toEqual({
			hosts: [{ id: "a", name: "laptop", endpoint: "ws://laptop:6767/endpoint" }],
			activeEndpoint: "ws://laptop:6767/endpoint",
		});

		storage.data["facet.hosts"] = JSON.stringify([{ id: "b" }, null, 1]);
		expect(readHostList(storage, "ws://x/endpoint").hosts).toEqual([]);
	});
});

describe("hasEndpoint", () => {
	const state = {
		hosts: [{ id: "a", name: "laptop", endpoint: "ws://laptop:6767/endpoint" }],
		activeEndpoint: "ws://127.0.0.1:1/endpoint",
	};

	it("本机与已保存的都算重复", () => {
		expect(hasEndpoint(state, "ws://127.0.0.1:1/endpoint", "ws://127.0.0.1:1/endpoint")).toBe(true);
		expect(hasEndpoint(state, "ws://laptop:6767/endpoint", "ws://127.0.0.1:1/endpoint")).toBe(true);
	});

	it("没见过的端点不算", () => {
		expect(hasEndpoint(state, "ws://other:2/endpoint", "ws://127.0.0.1:1/endpoint")).toBe(false);
	});
});
