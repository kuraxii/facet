import { describe, expect, it } from "vitest";
import { ApprovalBroker } from "./approval-broker.ts";

const request = { id: "req-1", callId: "call-1", toolName: "bash", input: {}, cwd: "/tmp" };

describe("ApprovalBroker", () => {
	it("未应答前保持挂起，应答后返回该决定", async () => {
		const broker = new ApprovalBroker();
		const pending = broker.handler(request);
		expect(broker.pendingCount).toBe(1);
		expect(broker.respond("req-1", { action: "allow" })).toBe(true);
		await expect(pending).resolves.toEqual({ action: "allow" });
		expect(broker.pendingCount).toBe(0);
	});

	it("未知请求返回假", () => {
		const broker = new ApprovalBroker();
		expect(broker.respond("missing", { action: "deny" })).toBe(false);
	});

	it("释放时把未应答请求按拒绝处理", async () => {
		const broker = new ApprovalBroker();
		const pending = broker.handler(request);
		broker.release("会话已释放");
		await expect(pending).resolves.toEqual({ action: "deny", reason: "会话已释放" });
	});

	it("释放后的新请求直接拒绝", async () => {
		const broker = new ApprovalBroker();
		broker.release("设备关闭");
		await expect(broker.handler(request)).resolves.toEqual({ action: "deny", reason: "会话已释放" });
	});
});
