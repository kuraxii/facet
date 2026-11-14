import { describe, expect, it } from "vitest";
import { loadServerConfig } from "./config.ts";

const BASE = { FACET_DATA_DIR: "/data/facet-dev", XDG_RUNTIME_DIR: "/run/user/1000" };

describe("loadServerConfig 的监听方式", () => {
	it("缺省只开 unix socket，路径落在 XDG_RUNTIME_DIR 下", () => {
		const config = loadServerConfig(BASE);
		expect(config.socketPath).toBe("/run/user/1000/facet-dev/host.sock");
	});

	it("没有 XDG_RUNTIME_DIR 时退回数据目录", () => {
		const config = loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev" });
		expect(config.socketPath).toBe("/data/facet-dev/host.sock");
	});

	it("给了 FACET_PORT 就按 TCP 走，不开 socket", () => {
		expect(loadServerConfig({ ...BASE, FACET_PORT: "4319" }).socketPath).toBeUndefined();
		expect(loadServerConfig({ ...BASE, FACET_PORT: "4319" }).port).toBe(4319);
	});

	it("给了监听地址也按 TCP 走", () => {
		expect(loadServerConfig({ ...BASE, FACET_HOST: "192.168.1.5" }).socketPath).toBeUndefined();
	});

	it("FACET_SOCKET 覆盖缺省路径", () => {
		expect(loadServerConfig({ ...BASE, FACET_SOCKET: "/tmp/custom.sock" }).socketPath).toBe(
			"/tmp/custom.sock",
		);
	});

	it("数据目录换名字时 socket 目录跟着换，开发实例与发布实例分开", () => {
		expect(loadServerConfig({ ...BASE, FACET_DATA_DIR: "/data/facet" }).socketPath).toBe(
			"/run/user/1000/facet/host.sock",
		);
	});
});
