/**
 * 状态转移表。
 *
 * 这里只测纯函数：命令侧节点与 pi 事件的先后顺序、重复到达都只该影响落点，不该产生
 * 非法回跳。外壳（`PiAgent`）负责在状态变化时对外发事件，它不参与这些判断。
 */
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { TurnPhase } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { reduceTurnState, sameTurnState, type TurnInput, type TurnState } from "./events.ts";

const idle: TurnState = { phase: "idle", maintenance: undefined };

function at(phase: TurnPhase): TurnState {
	return { phase, maintenance: undefined };
}

/** 造一条 pi 事件，只给用例用到的字段。 */
function event(type: string, extra: Record<string, unknown> = {}): TurnInput {
	return { kind: "event", event: { type, ...extra } as unknown as AgentSessionEvent };
}

/** 依次喂多段输入，返回落点。 */
function run(start: TurnState, inputs: readonly TurnInput[]): TurnState {
	return inputs.reduce((current, input) => reduceTurnState(current, input), start);
}

describe("reduceTurnState", () => {
	it("正常一轮：开始 → 流式 → 收尾回到空闲", () => {
		const started = run(idle, [
			{ kind: "prompt_requested", streaming: false },
			event("agent_start"),
			event("agent_settled"),
		]);
		expect(started).toEqual(idle);
		// 中间每一步的落点单独看一遍
		expect(reduceTurnState(idle, { kind: "prompt_requested", streaming: false })).toEqual(at("starting"));
		expect(reduceTurnState(at("starting"), event("agent_start"))).toEqual(at("running"));
		expect(reduceTurnState(at("running"), event("agent_settled"))).toEqual(idle);
	});

	it("preflight 失败直接落回空闲", () => {
		const failed = run(idle, [
			{ kind: "prompt_requested", streaming: false },
			{ kind: "command_finally", streaming: false },
		]);
		expect(failed).toEqual(idle);
	});

	it("启动中取消：starting → stopping → idle", () => {
		expect(reduceTurnState(at("starting"), { kind: "abort_requested" })).toEqual(at("stopping"));
		expect(reduceTurnState(at("stopping"), { kind: "command_finally", streaming: false })).toEqual(idle);
	});

	it("流式中取消：running → stopping，settled 之后回到 idle", () => {
		const stopping = reduceTurnState(at("running"), { kind: "abort_requested" });
		expect(stopping).toEqual(at("stopping"));
		expect(reduceTurnState(stopping, event("agent_settled"))).toEqual(idle);
	});

	it("settled 先到、命令侧收尾后到：幂等，不回跳", () => {
		const settled = reduceTurnState(at("stopping"), event("agent_settled"));
		expect(settled).toEqual(idle);
		expect(reduceTurnState(settled, { kind: "command_finally", streaming: false })).toEqual(idle);
	});

	it("收尾先到、settled 后到：同样幂等", () => {
		const finished = reduceTurnState(at("stopping"), { kind: "command_finally", streaming: false });
		expect(finished).toEqual(idle);
		expect(reduceTurnState(finished, event("agent_settled"))).toEqual(idle);
	});

	it("重复的 settled 不再产生新状态", () => {
		expect(reduceTurnState(idle, event("agent_settled"))).toEqual(idle);
		expect(sameTurnState(idle, reduceTurnState(idle, event("agent_settled")))).toBe(true);
	});

	it("重复的 agent_start 不会重新进入运行", () => {
		expect(reduceTurnState(at("running"), event("agent_start"))).toEqual(at("running"));
	});

	it("空闲时取消、空闲时收尾都不改动阶段", () => {
		expect(reduceTurnState(idle, { kind: "abort_requested" })).toEqual(idle);
		expect(reduceTurnState(idle, { kind: "command_finally", streaming: false })).toEqual(idle);
	});

	it("流式期间不做开始、也不做收尾", () => {
		expect(reduceTurnState(at("running"), { kind: "prompt_requested", streaming: true })).toEqual(
			at("running"),
		);
		expect(reduceTurnState(at("stopping"), { kind: "command_finally", streaming: true })).toEqual(
			at("stopping"),
		);
	});

	it("维护动作与阶段互不干扰", () => {
		const compacting = reduceTurnState(at("running"), event("compaction_start", { reason: "manual" }));
		expect(compacting.phase).toBe("running");
		expect(compacting.maintenance).toMatchObject({ kind: "compaction", reason: "manual" });
		const retrying = reduceTurnState(
			compacting,
			event("auto_retry_start", { attempt: 1, maxAttempts: 3, delayMs: 5 }),
		);
		expect(retrying.maintenance).toMatchObject({ kind: "retry", attempt: 1 });
		// settled 会把维护动作一起收干净
		expect(reduceTurnState(retrying, event("agent_settled"))).toEqual(idle);
	});
});
