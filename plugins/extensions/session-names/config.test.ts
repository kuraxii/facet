import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SUMMARY_PROMPT, formatModelSpec, loadConfig, parseModelSpec, saveConfig } from "./config.ts";

const roots: string[] = [];

async function tempConfig(): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "facet-session-names-"));
	roots.push(root);
	return join(root, "session-names.json");
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("session names config", () => {
	it("creates defaults on first read", async () => {
		const path = await tempConfig();
		expect(loadConfig(path)).toEqual({
			model: null,
			autoNameNewSessions: true,
			summaryPrompt: DEFAULT_SUMMARY_PROMPT,
			maxNameLength: 30,
		});
		const written = JSON.parse(await readFile(path, "utf8")) as { autoNameNewSessions: boolean };
		expect(written.autoNameNewSessions).toBe(true);
	});

	it("accepts the old overwrite value as enabled", async () => {
		const path = await tempConfig();
		await writeFile(path, JSON.stringify({ autoNameNewSessions: "overwrite" }), "utf8");
		expect(loadConfig(path).autoNameNewSessions).toBe(true);
	});

	it("clamps invalid lengths and keeps a custom prompt", async () => {
		const path = await tempConfig();
		await writeFile(
			path,
			JSON.stringify({ maxNameLength: 500, summaryPrompt: " Use Chinese. ", model: " p/m " }),
			"utf8",
		);
		expect(loadConfig(path)).toMatchObject({
			maxNameLength: 100,
			summaryPrompt: " Use Chinese. ",
			model: "p/m",
		});
	});

	it("writes a patch and reads it back", async () => {
		const path = await tempConfig();
		saveConfig({ model: "openai/gpt-5", autoNameNewSessions: false }, path);
		expect(loadConfig(path)).toMatchObject({ model: "openai/gpt-5", autoNameNewSessions: false });
	});

	it("formats and parses model specs", () => {
		expect(parseModelSpec("openai/gpt-5")).toEqual({ provider: "openai", modelId: "gpt-5" });
		expect(parseModelSpec("provider/model/with/slash")).toEqual({
			provider: "provider",
			modelId: "model/with/slash",
		});
		expect(parseModelSpec("bad")).toBeNull();
		expect(parseModelSpec(null)).toBeNull();
		expect(formatModelSpec({ provider: "p", id: "m" })).toBe("p/m");
	});
});
