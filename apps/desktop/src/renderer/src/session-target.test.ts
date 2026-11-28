import { describe, expect, it } from "vitest";
import { sameTarget, toSessionKey } from "./session-target.ts";

describe("session-target", () => {
	it("按 endpoint 与 file 构造联合会话键并区分不同主机同路径会话", () => {
		expect(toSessionKey("local", "/work/s1.jsonl")).toBe("local::/work/s1.jsonl");
		expect(toSessionKey("ssh://laptop", "/work/s1.jsonl")).toBe("ssh://laptop::/work/s1.jsonl");
		expect(toSessionKey("local", "/work/s1.jsonl")).not.toBe(toSessionKey("ssh://laptop", "/work/s1.jsonl"));
	});

	it("判断两个 ActiveTarget 是否相同", () => {
		expect(sameTarget(undefined, undefined)).toBe(true);
		expect(sameTarget({ endpoint: "local", file: "/a" }, undefined)).toBe(false);
		expect(sameTarget({ endpoint: "local", file: "/a" }, { endpoint: "local", file: "/a" })).toBe(true);
		expect(sameTarget({ endpoint: "local", file: "/a" }, { endpoint: "ssh://box", file: "/a" })).toBe(false);
	});
});
