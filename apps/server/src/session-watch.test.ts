/**
 * 会话目录监听的测试。
 *
 * 覆盖写入、删除、非会话文件、合并时间片与停止。
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type SessionFileChange, SessionWatch } from "./session-watch.ts";

const roots: string[] = [];

async function tempSessions(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "facet-watch-"));
	roots.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** 收下变化的记录器。 */
function recorder() {
	const batches: SessionFileChange[][] = [];
	return { batches, onChange: (changes: readonly SessionFileChange[]) => batches.push([...changes]) };
}

/**
 * 等预期出现。
 *
 * 事件、去抖与 `stat` 都要时间，全量测试并行跑时更慢，固定睡眠会被机器负载带偏，
 * 所以这里等到条件成立为止；没人报变化就等到超时再判失败。
 */
async function expectBatches(
	batches: SessionFileChange[][],
	expected: number | ((count: number) => boolean),
): Promise<void> {
	await vi.waitFor(
		() => {
			if (typeof expected === "number") {
				expect(batches.flat()).toHaveLength(expected);
				return;
			}
			expect(expected(batches.flat().length)).toBe(true);
		},
		{ timeout: 5000, interval: 25 },
	);
}

/** 等一段时间，用来断言「不该有推送」。 */
async function quiet(ms = 400): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, ms));
}

describe("SessionWatch", () => {
	it("子目录里的会话文件写入会报 changed", async () => {
		const sessionsDir = await tempSessions();
		await mkdir(join(sessionsDir, "--a--"), { recursive: true });
		const { batches, onChange } = recorder();
		const watch = new SessionWatch({ sessionsDir, debounceMs: 20, onChange });
		await watch.start();
		await writeFile(join(sessionsDir, "--a--", "s1.jsonl"), "{}\n", "utf8");
		await expectBatches(batches, 1);
		expect(batches.flat()).toEqual([{ file: join(sessionsDir, "--a--", "s1.jsonl"), kind: "changed" }]);
		watch.stop();
	});

	it("文件消失后报 removed", async () => {
		const sessionsDir = await tempSessions();
		await mkdir(join(sessionsDir, "--a--"), { recursive: true });
		const file = join(sessionsDir, "--a--", "s1.jsonl");
		await writeFile(file, "{}\n", "utf8");
		const { batches, onChange } = recorder();
		const watch = new SessionWatch({ sessionsDir, debounceMs: 20, onChange });
		await watch.start();
		await rm(file);
		await expectBatches(batches, 1);
		expect(batches.flat()).toEqual([{ file, kind: "removed" }]);
		watch.stop();
	});

	it("非会话文件不报", async () => {
		const sessionsDir = await tempSessions();
		const { batches, onChange } = recorder();
		const watch = new SessionWatch({ sessionsDir, debounceMs: 20, onChange });
		await watch.start();
		await writeFile(join(sessionsDir, "notes.txt"), "x\n", "utf8");
		await quiet();
		expect(batches).toEqual([]);
		watch.stop();
	});

	it("同一批里同一个文件只出现一次", async () => {
		const sessionsDir = await tempSessions();
		await mkdir(join(sessionsDir, "--a--"), { recursive: true });
		const { batches, onChange } = recorder();
		const watch = new SessionWatch({ sessionsDir, debounceMs: 50, onChange });
		await watch.start();
		const file = join(sessionsDir, "--a--", "s1.jsonl");
		// 连续两次写入：无论合成一批还是落到两批，每批里这个文件都只能出现一次
		await writeFile(file, "{}\n", "utf8");
		await writeFile(file, "{}\n{}\n", "utf8");
		await expectBatches(batches, (count) => count > 0);
		for (const batch of batches) {
			expect(batch.filter((change) => change.file === file)).toHaveLength(1);
		}
		watch.stop();
	});

	it("stop 之后不再报", async () => {
		const sessionsDir = await tempSessions();
		const { batches, onChange } = recorder();
		const watch = new SessionWatch({ sessionsDir, debounceMs: 20, onChange });
		await watch.start();
		watch.stop();
		await writeFile(join(sessionsDir, "s1.jsonl"), "{}\n", "utf8");
		await quiet();
		expect(batches).toEqual([]);
	});

	it("会话目录不存在时先建出来再监听", async () => {
		const missing = join(await tempSessions(), "missing");
		const { batches, onChange } = recorder();
		const watch = new SessionWatch({ sessionsDir: missing, debounceMs: 20, onChange });
		await watch.start();
		const file = join(missing, "--a--", "s1.jsonl");
		await mkdir(join(missing, "--a--"), { recursive: true });
		await writeFile(file, "{}\n", "utf8");
		await expectBatches(batches, 1);
		expect(batches.flat()).toEqual([{ file, kind: "changed" }]);
		watch.stop();
	});
});
