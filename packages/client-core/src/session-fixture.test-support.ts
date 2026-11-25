/**
 * 测试用的会话快照夹具。
 *
 * `SessionSnapshot` 字段多且几乎全是"与用例无关的固定值"，每个测试文件各抄一份既啰嗦又容易
 * 长歪；这里给一份完整的底稿，用例只覆盖它关心的那几个字段。
 */
import type { SessionSnapshot } from "@facet/protocol";

/** 一份空闲态会话快照。 */
export function sessionSnapshot(): SessionSnapshot {
	return {
		id: "s1",
		file: "/tmp/s1.jsonl",
		cwd: "/tmp",
		name: "既有会话",
		phase: "idle",
		maintenance: undefined,
		model: undefined,
		thinkingLevel: "medium",
		availableThinkingLevels: ["medium"],
		activeToolNames: [],
		queued: { steering: [], followUp: [] },
		contextUsage: undefined,
		stats: {
			sessionId: "s1",
			sessionFile: "/tmp/s1.jsonl",
			userMessages: 0,
			assistantMessages: 0,
			toolCalls: 0,
			toolResults: 0,
			totalMessages: 0,
			tokens: { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, total: 0 },
			cost: 0,
			contextUsage: undefined,
		},
		modelFallbackMessage: undefined,
	};
}
