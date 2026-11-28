import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AcpProbeSessionStore } from "./acp-probe-session.ts";

describe("AcpProbeSessionStore", () => {
	const dirs: string[] = [];

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("按 agentId 持久化、读取与清除占位空会话 id", async () => {
		const dir = mkdtempSync(join(tmpdir(), "facet-acp-probe-"));
		dirs.push(dir);

		const store = new AcpProbeSessionStore(dir);
		expect(store.get("antigravity")).toBeUndefined();

		await store.set("antigravity", "ext-probe-1");
		const reloaded = new AcpProbeSessionStore(dir);
		expect(reloaded.get("antigravity")).toBe("ext-probe-1");

		await reloaded.clear("antigravity");
		const afterClear = new AcpProbeSessionStore(dir);
		expect(afterClear.get("antigravity")).toBeUndefined();
	});
});
