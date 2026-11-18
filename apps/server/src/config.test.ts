import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSocketPath, loadServerConfig } from "./config.ts";

describe("loadServerConfig 的监听方式", () => {
	it("缺省只开 unix socket：有运行目录时放运行目录，名字按实例区分", () => {
		// 期望值用 join 拼：路径分隔符随宿主平台变，规则本身与平台无关
		expect(
			loadServerConfig({ FACET_DATA_DIR: "/data/facet", XDG_RUNTIME_DIR: "/run/user/1000" }, "linux")
				.socketPath,
		).toBe(join("/run/user/1000", "facet.sock"));
		expect(
			loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev", XDG_RUNTIME_DIR: "/run/user/1000" }, "linux")
				.socketPath,
		).toBe(join("/run/user/1000", "facet-dev.sock"));
	});

	it("没有运行目录时落在数据目录下", () => {
		expect(loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev" }, "linux").socketPath).toBe(
			join("/data/facet-dev", "facet.sock"),
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

describe("Windows 上的本机 socket", () => {
	it("改用具名管道，名字取数据目录的摘要，开发实例与发布实例不同名", () => {
		expect(defaultSocketPath({}, "/data/facet", "win32")).toBe("\\\\.\\pipe\\facet-252272ec9bcb");
		expect(defaultSocketPath({}, "/data/facet-dev", "win32")).toBe("\\\\.\\pipe\\facet-80d4e7bdd3a2");
	});

	it("不看运行目录：Windows 上没有 XDG_RUNTIME_DIR", () => {
		expect(defaultSocketPath({ XDG_RUNTIME_DIR: "/run/user/1000" }, "/data/facet-dev", "win32")).toBe(
			"\\\\.\\pipe\\facet-80d4e7bdd3a2",
		);
	});

	it("FACET_SOCKET 仍然优先", () => {
		expect(
			loadServerConfig({ FACET_DATA_DIR: "/data/facet-dev", FACET_SOCKET: "\\\\.\\pipe\\custom" }, "win32")
				.socketPath,
		).toBe("\\\\.\\pipe\\custom");
	});
});
