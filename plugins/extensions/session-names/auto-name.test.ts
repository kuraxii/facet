import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { findNameSource, hasOwnName } from "./auto-name.ts";

function message(id: string, role: "user" | "assistant", text: string): SessionEntry {
	return {
		type: "message",
		id,
		message: { role, content: [{ type: "text", text }] },
	} as unknown as SessionEntry;
}

function info(id: string, name: string | undefined): SessionEntry {
	return { type: "session_info", id, name } as unknown as SessionEntry;
}

function context(name: string | undefined): ExtensionContext {
	return {
		sessionManager: {
			getSessionName: () => name,
			getSessionDir: () => "/sessions",
		},
	} as unknown as ExtensionContext;
}

describe("session name source", () => {
	it("takes the first user message and skips assistant messages", () => {
		const entries = [
			message("a", "assistant", "hi"),
			message("u1", "user", "first"),
			message("u2", "user", "second"),
		];
		expect(findNameSource(entries, undefined)).toBe("first");
	});

	it("skips entries inherited from the parent on a fork", () => {
		const parent = new Set(["u1"]);
		const entries = [message("u1", "user", "parent topic"), message("u2", "user", "child topic")];
		expect(findNameSource(entries, parent)).toBe("child topic");
	});

	it("returns null when no post-fork user message exists", () => {
		expect(findNameSource([message("u1", "user", "parent topic")], new Set(["u1"]))).toBeNull();
	});
});

describe("existing session names", () => {
	it("uses the session manager name for a normal session", () => {
		expect(hasOwnName(context("named"), [], undefined)).toBe(true);
		expect(hasOwnName(context("  "), [], undefined)).toBe(false);
		expect(hasOwnName(context(undefined), [], undefined)).toBe(false);
	});

	it("ignores inherited names on a fork", () => {
		const parent = new Set(["i1"]);
		expect(hasOwnName(context("parent name"), [info("i1", "parent name")], parent)).toBe(false);
		expect(
			hasOwnName(context("parent name"), [info("i1", "parent name"), info("i2", "child name")], parent),
		).toBe(true);
	});
});
