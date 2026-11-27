import { describe, expect, it } from "vitest";
import { isAcpLocator, makeAcpLocator, parseAcpLocator } from "./backend.ts";

describe("ACP 会话定位符工具", () => {
	it("编码与解码保持后端标识和外部会话标识无损", () => {
		const locator = makeAcpLocator("antigravity", "sess/123:abc");
		expect(locator.startsWith("acp://")).toBe(true);
		expect(isAcpLocator(locator)).toBe(true);
		expect(parseAcpLocator(locator)).toEqual({
			backendId: "antigravity",
			externalSessionId: "sess/123:abc",
		});
	});

	it("普通文件路径与非法定位符返回 undefined", () => {
		expect(isAcpLocator("/tmp/s1.jsonl")).toBe(false);
		expect(parseAcpLocator("acp://")).toBeUndefined();
		expect(parseAcpLocator("acp://antigravity/")).toBeUndefined();
		expect(parseAcpLocator("acp:///session")).toBeUndefined();
		expect(parseAcpLocator("acp://%E0%A4%A/session")).toBeUndefined();
	});
});
