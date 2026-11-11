import { describe, expect, it } from "vitest";
import { RequestEpoch } from "./request-epoch.ts";

describe("请求轮次", () => {
	it("推进之后旧标记作废", () => {
		const epoch = new RequestEpoch();
		const first = epoch.advance();
		expect(epoch.matches(first)).toBe(true);
		const second = epoch.advance();
		expect(epoch.matches(first)).toBe(false);
		expect(epoch.matches(second)).toBe(true);
	});

	it("关闭再打开使在途请求全部作废", () => {
		const epoch = new RequestEpoch();
		const request = epoch.advance();
		epoch.advance();
		epoch.advance();
		expect(epoch.matches(request)).toBe(false);
	});

	it("当前轮次随推进更新", () => {
		const epoch = new RequestEpoch();
		expect(epoch.value).toBe(0);
		const token = epoch.advance();
		expect(epoch.value).toBe(token);
	});
});
