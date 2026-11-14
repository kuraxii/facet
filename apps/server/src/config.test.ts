import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.ts";

describe("loadServerConfig 的监听方式", () => {
	it("缺省只开 unix socket：有运行目录时放运行目录，名字按实例区分", () => {
		expect(
			loadServerConfig({ FACET_DATA_DIR: "/data/facet", XDG_RUNTIME_DIR: "/run/user/1000" }).socketPath,
		).toBe("/run/user/1000/facet.sock");
		expect(
			loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev", XDG_RUNTIME_DIR: "/run/user/1000" }).socketPath,
		).toBe("/run/user/1000/facet-dev.sock");
	});

	it("没有运行目录时落在数据目录下", () => {
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
