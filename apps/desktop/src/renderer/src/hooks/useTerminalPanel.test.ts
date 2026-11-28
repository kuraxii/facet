/**
 * 终端面板恢复过滤与自动拉起判定测试。
 */
import type { TerminalInfo } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { findRunningTerminal, liveTerminalsOf, shouldAutoOpenTerminal } from "./useTerminalPanel.ts";

function fakeTerminal(overrides: Partial<TerminalInfo> = {}): TerminalInfo {
	return {
		id: "term-1",
		cwd: "/repo",
		shell: "/bin/zsh",
		title: "zsh",
		cols: 100,
		rows: 24,
		pid: 1234,
		createdAt: 1,
		lastUsedAt: 1,
		exit: null,
		restored: false,
		...overrides,
	};
}

describe("liveTerminalsOf", () => {
	it("过滤重启前遗留的 restored 空壳，保留当前运行期内已退出或运行中的终端", () => {
		const alive = fakeTerminal({ id: "live-1", restored: false, exit: null });
		const exited = fakeTerminal({ id: "exited-1", restored: false, exit: { exitCode: 0 } });
		const stale = fakeTerminal({ id: "stale-1", pid: 0, restored: true, exit: null });

		expect(liveTerminalsOf([stale, alive, exited]).map((item) => item.id)).toEqual(["live-1", "exited-1"]);
	});
});

describe("findRunningTerminal", () => {
	it("优先返回最新一个仍在运行的终端，忽略已退出与恢复空壳", () => {
		const stale = fakeTerminal({ id: "stale", restored: true, exit: null });
		const exited = fakeTerminal({ id: "exited", restored: false, exit: { exitCode: 0 } });
		const first = fakeTerminal({ id: "live-1", restored: false, exit: null });
		const second = fakeTerminal({ id: "live-2", restored: false, exit: null });

		expect(findRunningTerminal([stale, exited, first, second])?.id).toBe("live-2");
		expect(findRunningTerminal([stale, exited])).toBeUndefined();
	});
});

describe("shouldAutoOpenTerminal", () => {
	const base = {
		canUseTerminal: true,
		autoOpen: true,
		connectEpoch: 1,
		syncedEpoch: 1,
		autoOpenedEpoch: 0,
		liveTerminalCount: 0,
	};

	it("连接清单同步完成、终端标签可见且无存活终端时允许自动拉起", () => {
		expect(shouldAutoOpenTerminal(base)).toBe(true);
	});

	it("清单尚未同步到当前连接代次时不抢先拉起", () => {
		expect(shouldAutoOpenTerminal({ ...base, syncedEpoch: 0 })).toBe(false);
		expect(shouldAutoOpenTerminal({ ...base, connectEpoch: 0, syncedEpoch: 0 })).toBe(false);
	});

	it("已有存活终端或终端标签当前不可见时不自动拉起", () => {
		expect(shouldAutoOpenTerminal({ ...base, liveTerminalCount: 1 })).toBe(false);
		expect(shouldAutoOpenTerminal({ ...base, autoOpen: false })).toBe(false);
		expect(shouldAutoOpenTerminal({ ...base, canUseTerminal: false })).toBe(false);
	});

	it("同一连接代次已自动触发过一次后不再重复拉起", () => {
		expect(shouldAutoOpenTerminal({ ...base, autoOpenedEpoch: 1 })).toBe(false);
		expect(shouldAutoOpenTerminal({ ...base, connectEpoch: 2, syncedEpoch: 2, autoOpenedEpoch: 1 })).toBe(
			true,
		);
	});
});
