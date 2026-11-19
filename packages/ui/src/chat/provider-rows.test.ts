import type { CustomProviderInfo, ProviderInfo } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { providerRows } from "./provider-rows.ts";

const builtin = (id: string, name: string): ProviderInfo => ({
	id,
	name,
	authenticated: false,
	modelCount: 3,
});

const custom = (id: string, name: string): CustomProviderInfo => ({
	id,
	name,
	baseUrl: "https://gateway.example.com/v1",
	api: "openai-completions",
	models: [{ id: "m1" }, { id: "m2" }],
});

describe("提供方列表", () => {
	it("自定义提供方只出现一次,并带上自己的配置", () => {
		const rows = providerRows(
			[builtin("zai", "Z.AI"), builtin("aimao", "aimao")],
			[custom("aimao", "aimao")],
		);
		expect(rows.map((row) => row.provider.id)).toEqual(["zai", "aimao"]);
		expect(rows[0]?.custom).toBeUndefined();
		expect(rows[1]?.custom?.baseUrl).toBe("https://gateway.example.com/v1");
	});

	it("目录里还没有的自定义提供方补在末尾", () => {
		const rows = providerRows([builtin("zai", "Z.AI")], [custom("newapi", "newapi")]);
		expect(rows.map((row) => row.provider.id)).toEqual(["zai", "newapi"]);
		expect(rows[1]?.provider.modelCount).toBe(2);
		expect(rows[1]?.provider.baseUrl).toBe("https://gateway.example.com/v1");
	});

	it("没有自定义提供方时就是内置列表", () => {
		const rows = providerRows([builtin("zai", "Z.AI")], []);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.custom).toBeUndefined();
	});
});
