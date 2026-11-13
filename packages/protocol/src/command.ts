/**
 * 输入区可以触发的命令。
 *
 * 两类来源：图形界面自己实现的几条（改名、换模型、换思考档位、压缩），以及会话里注册的
 * 扩展命令、提示词模板与技能。后者发出去就是一整条消息，由 pi 自己展开或分发。
 */

/** 命令的来源。 */
export type CommandSource =
	/** 图形界面自己实现的基础命令 */
	| "builtin"
	/** 扩展用 `pi.registerCommand` 注册的命令 */
	| "extension"
	/** 提示词模板，通常来自 `.pi/prompts` 下的文件 */
	| "prompt"
	/** 技能，名字形如 `skill:名字` */
	| "skill";

/** 谁来执行这条命令。 */
export type CommandHandler =
	/** 界面处理：换模型、换思考档位、压缩、改名 */
	| "facet"
	/** 交给 pi：发成一条消息，由它分发扩展命令或展开模板与技能 */
	| "pi";

/** 一条命令。 */
export interface SlashCommand {
	/** 命令名，不带斜杠 */
	name: string;
	/** 一句话说明，列表里显示 */
	description?: string;
	/** 参数提示，例如 `<provider/model>` */
	argumentHint?: string;
	/** 来源 */
	source: CommandSource;
	/** 谁来执行 */
	handler: CommandHandler;
	/** 来源文件或扩展的路径，扩展与模板用得上 */
	origin?: string;
}
