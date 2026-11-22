/**
 * 模型表里的一行草稿。
 *
 * `key` 只用于渲染，跟着行走，不用下标当键：删掉中间一行时输入框不会串行。
 */
import type { CustomModelInfo } from "@facet/protocol";

/** 表单里的一行模型。 */
export interface ModelRow {
	/** 渲染用的稳定键 */
	key: string;
	/** 这一行的模型内容 */
	model: CustomModelInfo;
}

let rowCounter = 0;

/** 造一行模型，`key` 每次都不一样。 */
export function modelRow(model: CustomModelInfo = { id: "" }): ModelRow {
	rowCounter += 1;
	return { key: `row-${rowCounter}`, model };
}

/**
 * 从上游拉回同一标识的模型之后，这一行该变成什么样。
 *
 * 以拉回来的那份为准整行重写：展示名、上下文窗口、最大输出、思考档位都换成信息库给的；
 * 唯一的例外是展示名——信息库里没有名字、上游也没给名字时保留原来的，因为空展示名写不进
 * `models.json`（pi 要求至少一个字符），整行清空会让人没法保存。
 */
export function rewriteModelRow(row: ModelRow, fetched: CustomModelInfo): ModelRow {
	const id = fetched.id.trim();
	const name = fetched.name ?? row.model.name;
	return {
		key: row.key,
		model: {
			id,
			...(name === undefined ? {} : { name }),
			...(fetched.thinkingLevels === undefined ? {} : { thinkingLevels: fetched.thinkingLevels }),
			...(fetched.contextWindow === undefined ? {} : { contextWindow: fetched.contextWindow }),
			...(fetched.maxTokens === undefined ? {} : { maxTokens: fetched.maxTokens }),
		},
	};
}
