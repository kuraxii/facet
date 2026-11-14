import { describe, expect, it } from "vitest";
import {
	STATUS_RING_PERIOD_MS,
	statusBucketColor,
	statusBucketLabel,
	statusBucketOfDot,
	statusRingRotation,
} from "./session-status.ts";

describe("状态点分档", () => {
	it("运行与压缩都画运行中的环，空闲是弱化点", () => {
		expect(statusBucketOfDot("running")).toBe("running");
		expect(statusBucketOfDot("compacting")).toBe("running");
		expect(statusBucketOfDot("idle")).toBe("done");
	});

	it("颜色只在一处映射，done 没有强调色", () => {
		expect(statusBucketColor("running")).toBe("var(--dot-run)");
		expect(statusBucketColor("needs_input")).toBe("var(--dot-warn)");
		expect(statusBucketColor("attention")).toBe("var(--dot-ok)");
		expect(statusBucketColor("failed")).toBe("var(--dot-err)");
		expect(statusBucketColor("done")).toBeUndefined();
	});

	it("每档都有读屏可读的说明", () => {
		expect(statusBucketLabel("needs_input")).toBe("等待输入");
		expect(statusBucketLabel("failed")).toBe("失败");
	});
});

describe("环的旋转", () => {
	it("相位按绝对时间算，同一时刻的两个环角度一致", () => {
		expect(statusRingRotation(0)).toBe(0);
		expect(statusRingRotation(STATUS_RING_PERIOD_MS)).toBe(0);
		expect(statusRingRotation(STATUS_RING_PERIOD_MS / 2)).toBe(180);
		expect(statusRingRotation(1234)).toBeCloseTo(statusRingRotation(1234));
	});

	it("负数时间也落在 0 到 360 之间", () => {
		const angle = statusRingRotation(-STATUS_RING_PERIOD_MS / 4);
		expect(angle).toBeGreaterThanOrEqual(0);
		expect(angle).toBeLessThan(360);
		expect(angle).toBe(270);
	});
});
