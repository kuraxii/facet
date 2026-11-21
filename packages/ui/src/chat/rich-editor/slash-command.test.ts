/**
 * `/命令` 的触发判定：只有光标前的一整段 `/查询` 才算在打命令。
 */
import { describe, expect, it } from "vitest";
import { slashTrigger } from "./SlashCommandPlugin.tsx";

describe("命令查询", () => {
	it("斜杠开头且还没写参数时给出查询与替换范围", () => {
		expect(slashTrigger("/")).toEqual({ leadOffset: 0, matchingString: "", replaceableString: "/" });
		expect(slashTrigger("/comp")).toEqual({
			leadOffset: 0,
			matchingString: "comp",
			replaceableString: "/comp",
		});
		// 技能名里带冒号，不许把开头的 `/` 之外的东西当成边界
		expect(slashTrigger("/skill:deploy")).toEqual({
			leadOffset: 0,
			matchingString: "skill:deploy",
			replaceableString: "/skill:deploy",
		});
	});

	it("已经在写参数、正文里的斜杠、不以斜杠开头都不算", () => {
		expect(slashTrigger("/compact 现在压缩")).toBeNull();
		expect(slashTrigger("看一下 /model")).toBeNull();
		expect(slashTrigger("")).toBeNull();
	});
});
