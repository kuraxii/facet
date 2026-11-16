import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiAgentFactory, thinkingLevelForModel } from "./runtime.ts";

let root: string;
let factory: PiAgentFactory;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "facet-agent-trust-"));
	factory = await PiAgentFactory.create({ agentDir: join(root, "agent") });
});

afterEach(async () => {
	factory.dispose();
	await rm(root, { recursive: true, force: true });
});

/** 目录里放一份项目级扩展,让这个目录成为需要信任的目录。 */
async function projectWithExtension(name: string): Promise<string> {
	const cwd = join(root, name);
	await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
	await writeFile(join(cwd, ".pi", "extensions", "probe.ts"), "export default () => {};\n", "utf8");
	return cwd;
}

describe("项目信任", () => {
	it("目录里没有项目级资源时不必询问", async () => {
		const cwd = join(root, "plain");
		await mkdir(cwd);
		expect(factory.projectTrust(cwd)).toEqual({ hasProjectResources: false, trusted: undefined });
	});

	it("有项目级资源且没做过决定时返回未决定", async () => {
		const cwd = await projectWithExtension("app");
		expect(factory.projectTrust(cwd)).toEqual({ hasProjectResources: true, trusted: undefined });
	});

	it("记下决定之后按决定返回,重新打开工厂也读得到", async () => {
		const cwd = await projectWithExtension("app");
		factory.setProjectTrust(cwd, true);
		expect(factory.projectTrust(cwd)).toEqual({ hasProjectResources: true, trusted: true });

		const reopened = await PiAgentFactory.create({ agentDir: join(root, "agent") });
		expect(reopened.projectTrust(cwd).trusted).toBe(true);
		reopened.dispose();
	});

	it("不信任的决定同样记下来", async () => {
		const cwd = await projectWithExtension("app");
		factory.setProjectTrust(cwd, false);
		expect(factory.projectTrust(cwd)).toEqual({ hasProjectResources: true, trusted: false });
	});
});

describe("内置插件", () => {
	it("同名用户扩展不覆盖内置 ask_user_question", async () => {
		const cwd = await projectWithExtension("override-plugin");
		await writeFile(
			join(cwd, ".pi", "extensions", "probe.ts"),
			`export default (pi) => {
				pi.registerTool({
					name: "ask_user_question",
					label: "User",
					description: "user version",
					parameters: { type: "object", properties: {} },
				});
			};`,
			"utf8",
		);
		factory.setProjectTrust(cwd, true);
		const agent = await factory.create({ cwd });
		try {
			expect(agent.tools().find((tool) => tool.name === "ask_user_question")?.description).toContain(
				"structured questions",
			);
			expect(agent.issues).toEqual([]);
		} finally {
			agent.dispose();
		}
	});

	it("新会话默认注册 facet 的 ask_user_question", async () => {
		const cwd = join(root, "builtin-plugin");
		await mkdir(cwd);
		const agent = await factory.create({ cwd });
		try {
			expect(agent.activeToolNames()).toContain("ask_user_question");
			expect(agent.tools().find((tool) => tool.name === "ask_user_question")?.description).toContain(
				"structured questions",
			);
		} finally {
			agent.dispose();
		}
	});
});

describe("新建会话的思考档位", () => {
	it("模型支持思考时保留设置里的档位", () => {
		expect(thinkingLevelForModel({ reasoning: true }, "high")).toBe("high");
	});

	it("模型不支持思考时丢掉档位", () => {
		expect(thinkingLevelForModel({ reasoning: false }, "high")).toBeUndefined();
	});

	it("没有设置档位或模型未知时原样交出", () => {
		expect(thinkingLevelForModel({ reasoning: false }, undefined)).toBeUndefined();
		expect(thinkingLevelForModel(undefined, "low")).toBe("low");
	});
});

describe("内置扩展", () => {
	it("codemode 与 tool_search 会注册，但按 pi 的缺省不激活", async () => {
		const cwd = join(root, "tools");
		await mkdir(cwd);
		const agent = await factory.create({ cwd });
		const tools = agent.tools();
		const codemode = tools.find((tool) => tool.name === "codemode");
		expect(codemode).toBeDefined();
		// 注册不等于激活：要用 defaultTools 里的 +codemode 或 setActiveTools 打开
		expect(codemode?.active).toBe(false);
		expect(tools.some((tool) => tool.name === "tool_search")).toBe(true);
	});
});

describe("会话清单", () => {
	it("列出指定会话目录下的会话，摘要取文件内容", async () => {
		const sessionDir = join(root, "custom-sessions");
		await mkdir(sessionDir, { recursive: true });
		await writeFile(
			join(sessionDir, "s1.jsonl"),
			`${JSON.stringify({ type: "session", version: 3, id: "s1", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/work/a" })}\n${JSON.stringify(
				{ type: "message", id: "m1", parentId: null, message: { role: "user", content: "第一句" } },
			)}\n`,
			"utf8",
		);
		const scoped = await PiAgentFactory.create({ agentDir: join(root, "agent"), sessionDir });
		const sessions = await scoped.listSessions();
		expect(sessions.map((item) => item.id)).toEqual(["s1"]);
		expect(sessions[0]?.firstMessage).toBe("第一句");
		expect(sessions[0]?.cwd).toBe("/work/a");
		scoped.dispose();
	});

	it("invalidateSession 之后重读文件", async () => {
		const sessionDir = join(root, "custom-sessions-2");
		await mkdir(sessionDir, { recursive: true });
		const file = join(sessionDir, "s1.jsonl");
		const header = JSON.stringify({ type: "session", version: 3, id: "s1", cwd: "/work/a" });
		await writeFile(
			file,
			`${header}\n${JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "旧" } })}\n`,
			"utf8",
		);
		const scoped = await PiAgentFactory.create({ agentDir: join(root, "agent"), sessionDir });
		expect((await scoped.listSessions())[0]?.firstMessage).toBe("旧");
		await writeFile(
			file,
			`${header}\n${JSON.stringify({ type: "message", id: "m1", parentId: null, message: { role: "user", content: "新的内容" } })}\n`,
			"utf8",
		);
		scoped.invalidateSession(file);
		expect((await scoped.listSessions())[0]?.firstMessage).toBe("新的内容");
		scoped.dispose();
	});
});
