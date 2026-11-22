/**
 * 模型行里那组思考档位的纯逻辑。
 *
 * 界面只管「勾了哪几档」，挨着的两件事——当前勾选怎么变、格子里的摘要写什么——都不碰 React，
 * 放在这里给组件与用例共用。写入 `models.json` 的映射换算在主机侧（`packages/agent`），
 * 界面不重复一份。
 */
import type { ThinkingLevel } from "@facet/protocol";

/** 七档，从低到高；菜单按这个顺序排，勾选结果也按这个顺序存。 */
export const THINKING_LEVELS: readonly ThinkingLevel[] = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
];

/** 勾上一档或去掉一档，结果仍是标准顺序；同一档重复勾选不会出现两次。 */
export function toggleThinkingLevel(levels: readonly ThinkingLevel[], level: ThinkingLevel): ThinkingLevel[] {
	const next = levels.includes(level) ? levels.filter((item) => item !== level) : [...levels, level];
	return THINKING_LEVELS.filter((item) => next.includes(item));
}

/**
 * 格子里显示的摘要：勾到的最高一档，一档都没有时为空。
 *
 * 列的标题是「思考」，这一格读作「思考到哪一档」；整组明细在点开的菜单里看。
 */
export function topThinkingLevel(levels: readonly ThinkingLevel[]): ThinkingLevel | undefined {
	return THINKING_LEVELS.reduce<ThinkingLevel | undefined>(
		(top, level) => (levels.includes(level) ? level : top),
		undefined,
	);
}
