/**
 * 自定义提供方输入的归一。
 *
 * 线格式里可选的字符串允许空串（契约不定下限）。空串原样写进 models.json，会让 pi 的
 * schema 校验报 `name: must not have fewer than 1 characters`，而 pi 一旦校验失败就整份
 * 配置都不要——自定义提供方连同模型一起从目录里消失。所以进工厂之前先把这类空值归一成
 * `undefined`，写配置那一步就不会把它们写进文件。
 */
import type { RequestParams } from "@facet/protocol";

/** `saveCustomProvider` 参数里的那个提供方。 */
type ProviderInput = RequestParams["saveCustomProvider"]["provider"];

/** 一个模型输入。 */
type ModelInput = ProviderInput["models"][number];

/** 展示名：去掉首尾空白之后还有内容才算有，空串与纯空白都当作没填。 */
function displayName(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** 归一一个模型：展示名没填就把这个字段去掉，不留给后面的写入步骤。 */
function normalizeModel(model: ModelInput): ModelInput {
	const { name, ...rest } = model;
	const trimmed = displayName(name);
	return trimmed === undefined ? rest : { ...rest, name: trimmed };
}

/** 归一一个提供方输入。 */
export function normalizeProviderInput(provider: ProviderInput): ProviderInput {
	return { ...provider, models: provider.models.map(normalizeModel) };
}
