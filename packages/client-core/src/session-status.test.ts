import type { SessionStatus } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { deriveBucket } from "./session-status.ts";

/** 一份空闲状态，按需覆盖字段。 */
function status(overrides: Partial<SessionStatus>): SessionStatus {
	return { activity: "idle", settle: undefined, pendingInput: 0, seenAt: 0, ...overrides };
}

describe("deriveBucket", () => {
	it("有人等输入时压过其它状态", () => {
		const bucket = deriveBucket(
			status({
				activity: "running",
				pendingInput: 1,
				settle: { at: 100, outcome: "failed", message: "boom" },
				seenAt: 0,
			}),
		);
		expect(bucket).toBe("needs_input");
	});

	it("在忙时不显示上一个结果", () => {
		const bucket = deriveBucket(
			status({ activity: "running", settle: { at: 100, outcome: "completed", message: undefined } }),
		);
		expect(bucket).toBe("running");
	});

	it("压缩中也算在忙", () => {
		expect(deriveBucket(status({ activity: "compacting" }))).toBe("running");
	});

	it("未读的完成显示为待查看", () => {
		const bucket = deriveBucket(
			status({ settle: { at: 100, outcome: "completed", message: undefined }, seenAt: 50 }),
		);
		expect(bucket).toBe("attention");
	});

	it("未读的失败显示为失败", () => {
		const bucket = deriveBucket(
			status({ settle: { at: 100, outcome: "failed", message: "请求超时" }, seenAt: 50 }),
		);
		expect(bucket).toBe("failed");
	});

	it("看过的收尾回到已完成", () => {
		const bucket = deriveBucket(
			status({ settle: { at: 100, outcome: "failed", message: "请求超时" }, seenAt: 100 }),
		);
		expect(bucket).toBe("done");
	});

	it("从没跑完过的会话是已完成", () => {
		expect(deriveBucket(status({}))).toBe("done");
	});
});
