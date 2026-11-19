import { describe, expect, it } from "vitest";
import { normalizeProviderInput } from "./provider-input.ts";

const provider = {
	id: "aimao",
	name: "aimao",
	baseUrl: "https://gateway.example.com/v1",
	api: "openai-completions",
};

describe("自定义提供方输入的归一", () => {
	it("空串与纯空白的展示名当作没填", () => {
		const out = normalizeProviderInput({
			...provider,
			models: [
				{ id: "glm-5.3-flash", name: "" },
				{ id: "deepseek-v4.1-flash", name: "  " },
			],
		});
		expect(out.models).toEqual([{ id: "glm-5.3-flash" }, { id: "deepseek-v4.1-flash" }]);
	});

	it("有内容的展示名去掉首尾空白", () => {
		const out = normalizeProviderInput({
			...provider,
			models: [{ id: "glm-5.3-flash", name: "  GLM 5.3 Flash " }],
		});
		expect(out.models).toEqual([{ id: "glm-5.3-flash", name: "GLM 5.3 Flash" }]);
	});

	it("其余字段原样带过去", () => {
		const out = normalizeProviderInput({
			...provider,
			models: [{ id: "glm-5.3-flash", reasoning: true, contextWindow: 1000000, maxTokens: 8192 }],
		});
		expect(out).toEqual({
			...provider,
			models: [{ id: "glm-5.3-flash", reasoning: true, contextWindow: 1000000, maxTokens: 8192 }],
		});
	});
});
