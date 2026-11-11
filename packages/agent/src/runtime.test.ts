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
