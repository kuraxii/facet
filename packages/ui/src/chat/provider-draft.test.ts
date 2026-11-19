import { describe, expect, it } from "vitest";
import { providerDraftIssue } from "./provider-draft.ts";

const draft = {
	id: "aimao",
	name: "aimao",
	baseUrl: "https://gateway.example.com/v1",
	models: [{ id: "glm-5.3-flash", name: "GLM 5.3 Flash" }],
};

describe("提供方表单校验", () => {
	it("都填好了就没有问题", () => {
		expect(providerDraftIssue(draft)).toBeUndefined();
	});

	it("标识为空或不合规矩时给出标识那一条", () => {
		expect(providerDraftIssue({ ...draft, id: "" })).toBe("providerForm.invalidId");
		expect(providerDraftIssue({ ...draft, id: "  " })).toBe("providerForm.invalidId");
		expect(providerDraftIssue({ ...draft, id: "带 空格" })).toBe("providerForm.invalidId");
		expect(providerDraftIssue({ ...draft, id: "Z.AI" })).toBe("providerForm.invalidId");
	});

	it("名称与接口地址不能为空", () => {
		expect(providerDraftIssue({ ...draft, name: " " })).toBe("providerForm.invalidName");
		expect(providerDraftIssue({ ...draft, baseUrl: "" })).toBe("providerForm.invalidBaseUrl");
	});

	it("每个模型都要有标识与展示名", () => {
		expect(providerDraftIssue({ ...draft, models: [] })).toBe("providerForm.invalidModelId");
		expect(providerDraftIssue({ ...draft, models: [{ id: " ", name: "有名字" }] })).toBe(
			"providerForm.invalidModelId",
		);
		expect(providerDraftIssue({ ...draft, models: [{ id: "glm-5.3-flash" }] })).toBe(
			"providerForm.invalidModelName",
		);
		expect(providerDraftIssue({ ...draft, models: [{ id: "glm-5.3-flash", name: "  " }] })).toBe(
			"providerForm.invalidModelName",
		);
	});

	it("标识的问题排在名称与模型前面", () => {
		expect(providerDraftIssue({ ...draft, id: "", name: "", models: [] })).toBe("providerForm.invalidId");
		expect(providerDraftIssue({ ...draft, name: "", models: [{ id: "" }] })).toBe("providerForm.invalidName");
	});
});
