import { describe, expect, it } from "vitest";
import { openerFor, RevealFailedError, revealInFileManager, type SpawnLike } from "./reveal.ts";

/** 造一个替身进程：start 之后自己决定发出哪个事件。 */
function fakeSpawn(event: "spawn" | "error"): {
	start: SpawnLike;
	calls: Array<{ command: string; args: string[] }>;
} {
	const calls: Array<{ command: string; args: string[] }> = [];
	const start: SpawnLike = (command, args) => {
		calls.push({ command, args });
		let onSpawn: (() => void) | undefined;
		let onError: ((error: Error) => void) | undefined;
		const child = {
			once: (name: string, listener: never) => {
				if (name === "spawn") {
					onSpawn = listener as () => void;
				}
				if (name === "error") {
					onError = listener as (error: Error) => void;
				}
				return child;
			},
			unref: () => child,
		} as never;
		setTimeout(() => {
			if (event === "spawn") {
				onSpawn?.();
			} else {
				onError?.(new Error("spawn xdg-open ENOENT"));
			}
		}, 0);
		return child as ReturnType<SpawnLike>;
	};
	return { start, calls };
}

describe("在文件管理器中打开", () => {
	it("按平台选择命令", () => {
		expect(openerFor("linux")).toBe("xdg-open");
		expect(openerFor("darwin")).toBe("open");
		expect(openerFor("win32")).toBe("explorer");
	});

	it("把目录交给文件管理器", async () => {
		const { start, calls } = fakeSpawn("spawn");
		await revealInFileManager("/work/a", "linux", start);
		expect(calls).toEqual([{ command: "xdg-open", args: ["/work/a"] }]);
	});

	it("命令起不来时报错", async () => {
		const { start } = fakeSpawn("error");
		await expect(revealInFileManager("/work/a", "linux", start)).rejects.toBeInstanceOf(RevealFailedError);
	});
});
