import { describe, expect, it } from "vitest";
import { buildFileBreadcrumbs } from "./file-breadcrumbs.ts";

describe("file-breadcrumbs", () => {
	it("拆分项目名与相对路径为面包屑段落", () => {
		expect(buildFileBreadcrumbs("facet", "tools/mock-server/check.ts")).toEqual([
			"facet",
			"tools",
			"mock-server",
			"check.ts",
		]);
		expect(buildFileBreadcrumbs(undefined, "src\\index.ts")).toEqual(["src", "index.ts"]);
		expect(buildFileBreadcrumbs("facet", undefined)).toEqual(["facet"]);
		expect(buildFileBreadcrumbs(undefined, undefined)).toEqual([]);
	});
});
