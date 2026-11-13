/**
 * 命令的解析与过滤：什么时候弹列表、前缀怎么排、什么算界面自己处理。
 */
import type { SlashCommand } from "@facet/protocol";
import { describe, expect, it } from "vitest";
import { commandQuery, filterCommands, isFacetCommand, parseCommand } from "./command-palette.ts";

const MODEL: SlashCommand = { name: "model", description: "切换模型", source: "builtin", handler: "facet" };
const COMPACT: SlashCommand = {
	name: "compact",
	description: "压缩历史",
	source: "builtin",
	handler: "facet",
};
const REVIEW: SlashCommand = {
	name: "review",
	description: "请人审这段 diff",
	source: "prompt",
	handler: "pi",
};
const SKILL: SlashCommand = { name: "skill:deploy", description: "发布流程", source: "skill", handler: "pi" };
const PREVIEW: SlashCommand = { name: "preview", description: "预览改动", source: "prompt", handler: "pi" };
const COMMANDS = [MODEL, COMPACT, REVIEW, SKILL, PREVIEW];

describe("命令前缀", () => {
	it("斜杠开头且还没空格时才算在打命令", () => {
		expect(commandQuery("/comp")).toBe("comp");
		expect(commandQuery("/")).toBe("");
		expect(commandQuery("/compact 现在压缩")).toBeUndefined();
		expect(commandQuery("看一下 /model")).toBeUndefined();
		expect(commandQuery("")).toBeUndefined();
	});

	it("拆出命令名与参数", () => {
		expect(parseCommand("/model openai/gpt-5")).toEqual({ name: "model", args: "openai/gpt-5" });
		expect(parseCommand("/compact")).toEqual({ name: "compact", args: "" });
		expect(parseCommand("普通消息")).toBeUndefined();
	});

	it("前缀命中的排在前，其次名字含关键字，最后说明里含关键字", () => {
		// review 是前缀命中，preview 只是名字里含 re
		expect(filterCommands(COMMANDS, "re").map((c) => c.name)).toEqual(["review", "preview"]);
		// 名字一条都没命中时才退到说明里找
		expect(filterCommands(COMMANDS, "预览").map((c) => c.name)).toEqual(["preview"]);
		expect(filterCommands(COMMANDS, "压缩").map((c) => c.name)).toEqual(["compact"]);
		// 名字命中时不带出说明里含关键字的条目
		expect(filterCommands(COMMANDS, "co").map((c) => c.name)).toEqual(["compact"]);
		expect(filterCommands(COMMANDS, "").length).toBe(5);
	});

	it("界面自己处理的那几条认得出来", () => {
		expect(isFacetCommand(MODEL)).toBe(true);
		expect(isFacetCommand(REVIEW)).toBe(false);
		expect(isFacetCommand(undefined)).toBe(false);
	});
});
