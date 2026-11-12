/**
 * 嵌入主机子进程的测试。
 *
 * 只测能从输出里认出的就绪行，进程生命周期的部分靠真实启动验证。
 */
import { describe, expect, it } from "vitest";
import { parseReadyLine } from "./host-process.ts";

describe("parseReadyLine", () => {
	it("认出就绪行并取出端点与主机标识", () => {
		const line =
			'facet-host-ready {"endpoint":"ws://127.0.0.1:4100/endpoint","hostId":"abc","agentDir":"/tmp/x","pid":42}';
		expect(parseReadyLine(line)).toEqual({
			endpoint: "ws://127.0.0.1:4100/endpoint",
			hostId: "abc",
			agentDir: "/tmp/x",
			pid: 42,
		});
	});

	it("缺可选字段时给缺省值", () => {
		expect(parseReadyLine('facet-host-ready {"endpoint":"ws://x/endpoint","hostId":"abc"}')).toEqual({
			endpoint: "ws://x/endpoint",
			hostId: "abc",
			agentDir: "",
			pid: 0,
		});
	});

	it("普通日志行不算就绪", () => {
		expect(parseReadyLine("数据目录 /tmp/x")).toBeUndefined();
		expect(parseReadyLine("")).toBeUndefined();
	});

	it("标记之后不是 JSON 或缺端点时不算就绪", () => {
		expect(parseReadyLine("facet-host-ready 半个")).toBeUndefined();
		expect(parseReadyLine('facet-host-ready {"hostId":"abc"}')).toBeUndefined();
	});
});
