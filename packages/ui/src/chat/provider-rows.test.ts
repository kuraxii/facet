import { createI18n, translate } from "@facet/i18n";
import type { CustomProviderInfo, ProviderInfo } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { type ProviderRow, providerMeta, providerRows } from "./provider-rows.ts";

/** 列表行下面那行来源用中文渲染，数字与连接符照原样。 */
const t = translate(createI18n("zh-CN"));

/** 取第几行那行来源，缺行时直接失败。 */
function metaAt(rows: readonly ProviderRow[], index: number): string {
	const row = rows[index];
	if (row === undefined) {
		throw new Error(`缺少第 ${index} 行`);
	}
	return providerMeta(row, t);
}

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

	it("行里那行来源写地址与模型数,自定义的地址取自己的配置", () => {
		const rows = providerRows(
			[{ ...builtin("zai", "Z.AI"), baseUrl: "https://api.z.ai/v1/" }],
			[custom("aimao", "aimao")],
		);
		expect(metaAt(rows, 0)).toBe("api.z.ai/v1 · 3 个模型");
		expect(metaAt(rows, 1)).toBe("gateway.example.com/v1 · 2 个模型");
	});

	it("没有模型、地址也缺失时退回提供方标识", () => {
		const rows = providerRows([{ ...builtin("zai", "Z.AI"), modelCount: 0 }], []);
		expect(metaAt(rows, 0)).toBe("zai");
	});
});
