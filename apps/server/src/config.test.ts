import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.ts";

describe("loadServerConfig 的监听方式", () => {
	it("缺省只开 unix socket，固定落在数据目录下", () => {
		expect(loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev" }).socketPath).toBe(
			"/data/facet-dev/facet.sock",
		);
	});

	it("开发实例与发布实例按数据目录分开，socket 路径天然不同", () => {
		expect(loadServerConfig({ FACET_DATA_DIR: "/data/facet" }).socketPath).toBe("/data/facet/facet.sock");
		expect(loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev" }).socketPath).toBe(
			"/data/facet-dev/facet.sock",
		);
	});

	it("给了 FACET_PORT 就按 TCP 走，不开 socket", () => {
		const config = loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev", FACET_PORT: "4319" });
		expect(config.socketPath).toBeUndefined();
		expect(config.port).toBe(4319);
	});

	it("给了监听地址也按 TCP 走", () => {
		expect(
			loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev", FACET_HOST: "192.168.1.5" }).socketPath,
		).toBeUndefined();
	});

	it("FACET_SOCKET 覆盖缺省路径", () => {
		expect(
			loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev", FACET_SOCKET: "/tmp/custom.sock" }).socketPath,
		).toBe("/tmp/custom.sock");
	});
});
