import type { ContextBreakdown, Message, SessionStats } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import {
	alignContextBreakdown,
	computeCacheHitBreakdown,
	computeSessionTelemetry,
	estimateStreamingTps,
	formatTelemetryCost,
	formatTelemetryDuration,
	gaugeNeedleRotateDeg,
} from "./session-telemetry.ts";

describe("alignContextBreakdown", () => {
	it("按模型回报总用量使用最大余数法等比例校准各分类，加和精确等于 reportedTokens", () => {
		const breakdown: ContextBreakdown = {
			contextWindow: 200_000,
			reportedTokens: 10_000,
			reportedPercent: 5,
			estimatedTokens: 8_000,
			categories: [
				{ id: "system-prompt", tokens: 3_000 },
				{ id: "built-in-tools", tokens: 2_500 },
				{ id: "user-messages", tokens: 1_500 },
				{ id: "assistant-messages", tokens: 1_000 },
			],
			hiddenTools: [],
			compactions: 0,
		};

		const aligned = alignContextBreakdown(breakdown);
		expect(aligned.isEstimated).toBe(false);
		expect(aligned.usedTokens).toBe(10_000);
		expect(aligned.freeTokens).toBe(190_000);
		expect(aligned.usedPercent).toBe(5);
		const sum = aligned.categories.reduce((acc, c) => acc + c.tokens, 0);
		expect(sum).toBe(10_000);
	});

	it("压缩后尚未返回真实用量时回退为估算总量并标记 isEstimated", () => {
		const breakdown: ContextBreakdown = {
			contextWindow: 100_000,
			reportedTokens: null,
			reportedPercent: null,
			estimatedTokens: 4_500,
			categories: [
				{ id: "system-prompt", tokens: 2_500 },
				{ id: "compacted-data", tokens: 2_000 },
			],
			hiddenTools: [],
			compactions: 1,
		};

		const aligned = alignContextBreakdown(breakdown);
		expect(aligned.isEstimated).toBe(true);
		expect(aligned.usedTokens).toBe(4_500);
		expect(aligned.usedPercent).toBe(4.5);
		expect(aligned.freeTokens).toBe(95_500);
	});
});

describe("computeCacheHitBreakdown", () => {
	it("计算最近一次请求的缓存复用、写入与新增输入占比", () => {
		const cache = computeCacheHitBreakdown({
			input: 200,
			output: 50,
			cacheRead: 800,
			cacheWrite: 0,
			reasoning: 0,
		});
		expect(cache).toEqual({
			totalInput: 1000,
			cacheRead: 800,
			cacheWrite: 0,
			newInput: 200,
			cacheReadPercent: 80,
			cacheWritePercent: 0,
			newInputPercent: 20,
		});
	});
});

describe("computeSessionTelemetry", () => {
	const assistant = (output: number, durationMs: number, cacheRead = 0): Message => ({
		role: "assistant",
		content: [{ type: "text", text: "ok" }],
		provider: "p",
		model: "m",
		usage: {
			input: 100,
			output,
			cacheRead,
			cacheWrite: 0,
			reasoning: 10,
			totalTokens: 100 + output + cacheRead,
			cost: { input: 0.001, output: 0.002, cacheRead: 0, cacheWrite: 0, total: 0.003 },
		},
		stopReason: "stop",
		durationMs,
		timestamp: 1,
	});

	it("根据已完成助手消息与工具耗时计算最新/平均/峰值 tok/s，并优先用 SessionStats 兜底累计总量", () => {
		const messages: Message[] = [
			{ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 0 },
			assistant(100, 2_000, 400),
			{
				role: "toolResult",
				callId: "c1",
				toolName: "read",
				content: [{ type: "text", text: "data" }],
				isError: false,
				durationMs: 350,
				timestamp: 2,
			},
			assistant(60, 1_000, 800),
		];
		const stats: SessionStats = {
			sessionId: "s1",
			sessionFile: "/tmp/s1.jsonl",
			userMessages: 5,
			assistantMessages: 8,
			toolCalls: 4,
			toolResults: 4,
			totalMessages: 13,
			tokens: { input: 1_000, output: 500, cacheRead: 4_000, cacheWrite: 0, total: 5_500 },
			cost: 0.042,
			contextUsage: undefined,
		};

		const telemetry = computeSessionTelemetry(messages, stats);
		expect(telemetry.latestTps).toBe(60);
		expect(telemetry.peakTps).toBe(60);
		// (100 + 60) / (2s + 1s) = 53.3 tok/s
		expect(telemetry.avgTps).toBe(53.3);
		expect(telemetry.modelTimeMs).toBe(3_000);
		expect(telemetry.toolTimeMs).toBe(350);
		expect(telemetry.tokens.total).toBe(5_500);
		expect(telemetry.cacheHitPercent).toBe(80);
		expect(telemetry.cost).toBe(0.042);
		expect(telemetry.userMessages).toBe(5);
		expect(telemetry.assistantMessages).toBe(8);
	});
});

describe("estimateStreamingTps 与格式化", () => {
	it("流式达到足够采样窗口后给出估算速度", () => {
		expect(estimateStreamingTps(400, 2_000)).toBe(50);
		expect(estimateStreamingTps(8, 1_000)).toBeNull();
		expect(estimateStreamingTps(400, 100)).toBeNull();
	});

	it("格式化耗时与美元费用", () => {
		expect(formatTelemetryDuration(null)).toBe("-");
		expect(formatTelemetryDuration(450)).toBe("450ms");
		expect(formatTelemetryDuration(2_500)).toBe("2.5s");
		expect(formatTelemetryDuration(95_000)).toBe("1m 35s");
		expect(formatTelemetryCost(0.0025)).toBe("$0.0025");
		expect(formatTelemetryCost(1.234)).toBe("$1.23");
	});

	it("按生成速度映射 Lucide Gauge 指针旋转角度", () => {
		// 无数据或 0 tok/s 指向最左端 -110°（相对默认 +45° 偏转 -155°）
		expect(gaugeNeedleRotateDeg(null)).toBe(-155);
		expect(gaugeNeedleRotateDeg(0)).toBe(-155);
		// 60 tok/s 居中指向正上方 0°（偏转 -45°）
		expect(gaugeNeedleRotateDeg(60)).toBe(-45);
		// 超出上限按满刻度 +110°（偏转 +65°）封顶
		expect(gaugeNeedleRotateDeg(180)).toBe(65);
	});
});
