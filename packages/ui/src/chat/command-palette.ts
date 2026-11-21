/**
 * 输入区里的命令。
 *
 * 打入 `/` 之后列出候选，敲参数之前只按前缀过滤。命令分两类：界面自己处理的那几条，以及交给
 * pi 分发或展开的扩展命令、提示词模板与技能。
 */
import type { SlashCommand } from "@facet/protocol";

/** 命令来源的文案键，列表里显示成小标签。 */
export const SOURCE_LABEL_KEYS = {
	builtin: "commands.builtin",
	extension: "commands.extension",
	prompt: "commands.prompt",
	skill: "commands.skill",
} as const satisfies Record<SlashCommand["source"], string>;

/** 把一条输入拆成命令名与参数；开头不是命令时返回 undefined。 */
export function parseCommand(text: string): { name: string; args: string } | undefined {
	const trimmed = text.trim();
	if (!trimmed.startsWith("/")) {
		return undefined;
	}
	const body = trimmed.slice(1);
	const space = body.search(/\s/);
	if (space < 0) {
		return { name: body, args: "" };
	}
	return { name: body.slice(0, space), args: body.slice(space + 1).trim() };
}

/**
 * 按前缀挑出候选。
 *
 * 名字命中的优先：前缀命中的排在名字里含关键字的之前。名字一条都没命中时才退到说明里
 * 找，否则打两个字母就会把一堆说明里恰好含这两个字的技能都翻出来。
 */
export function filterCommands(commands: readonly SlashCommand[], query: string): SlashCommand[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) {
		return [...commands];
	}
	const prefix: SlashCommand[] = [];
	const nameHit: SlashCommand[] = [];
	const descriptionHit: SlashCommand[] = [];
	for (const command of commands) {
		const name = command.name.toLowerCase();
		if (name.startsWith(needle)) {
			prefix.push(command);
			continue;
		}
		if (name.includes(needle)) {
			nameHit.push(command);
			continue;
		}
		if (command.description?.toLowerCase().includes(needle) === true) {
			descriptionHit.push(command);
		}
	}
	if (prefix.length > 0 || nameHit.length > 0) {
		return [...prefix, ...nameHit];
	}
	return descriptionHit;
}

/** 这条命令由界面处理，发出去不算消息。 */
export function isFacetCommand(command: SlashCommand | undefined): boolean {
	return command?.handler === "facet";
}
