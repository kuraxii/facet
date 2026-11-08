import { homedir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyAgentDir, DEFAULT_AGENT_DIR } from "./paths.ts";

const ENV = "PI_CODING_AGENT_DIR";
let preset: string | undefined;

beforeEach(() => {
	preset = process.env[ENV];
	delete process.env[ENV];
});

afterEach(() => {
	if (preset === undefined) {
		delete process.env[ENV];
	} else {
		process.env[ENV] = preset;
	}
});

describe("applyAgentDir", () => {
	it("缺省指向 facet 的开发目录", () => {
		expect(DEFAULT_AGENT_DIR).toBe(resolve(homedir(), ".pi", "agent-dev"));
		expect(applyAgentDir()).toBe(DEFAULT_AGENT_DIR);
		expect(process.env[ENV]).toBe(DEFAULT_AGENT_DIR);
	});

	it("调用方给出的目录优先于缺省值", () => {
		const target = applyAgentDir("/tmp/facet-test-agent");
		expect(target).toBe("/tmp/facet-test-agent");
		expect(process.env[ENV]).toBe("/tmp/facet-test-agent");
	});

	it("已设置的环境变量优先于调用方给出的目录", () => {
		process.env[ENV] = "/tmp/facet-env-agent";
		expect(applyAgentDir("/tmp/facet-test-agent")).toBe("/tmp/facet-env-agent");
	});

	it("展开波浪号", () => {
		expect(applyAgentDir("~/facet-test-agent")).toBe(resolve(homedir(), "facet-test-agent"));
	});
});
