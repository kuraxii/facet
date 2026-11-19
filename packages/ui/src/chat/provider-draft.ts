/**
 * 提供方表单的本地校验。
 *
 * 只挡最明显的几条：空的、或者根本写不进 models.json 的值。主机侧还会再校验一次，这里存在的
 * 意义是让用户在弹窗里当场知道哪一项没填，而不是点完「保存」再从主机拿回一句错误。
 *
 * 校验只看值、不碰状态，所以单独放着，用例直接调它。
 */
import type { TranslationKey } from "@facet/i18n";

/** 校验用到的那几项，对应弹窗里的字段。 */
export interface ProviderDraftCheck {
	/** 提供方标识，自定义提供方的配置键 */
	id: string;
	/** 提供方名称 */
	name: string;
	/** 接口地址 */
	baseUrl: string;
	/** 模型行，逐行都要有标识与展示名 */
	models: readonly { id: string; name?: string }[];
}

/**
 * 按界面上的字段顺序逐条检查，返回第一处问题的文案键；都合格时返回 `undefined`。
 *
 * 展示名也要求填，是因为留空的值写不进 pi 的 models.json（它要求至少一个字符）。
 */
export function providerDraftIssue(draft: ProviderDraftCheck): TranslationKey | undefined {
	if (!/^[a-z0-9][a-z0-9._-]*$/.test(draft.id.trim())) {
		return "providerForm.invalidId";
	}
	if (draft.name.trim().length === 0) {
		return "providerForm.invalidName";
	}
	if (draft.baseUrl.trim().length === 0) {
		return "providerForm.invalidBaseUrl";
	}
	if (draft.models.length === 0 || draft.models.some((model) => model.id.trim().length === 0)) {
		return "providerForm.invalidModelId";
	}
	if (draft.models.some((model) => (model.name ?? "").trim().length === 0)) {
		return "providerForm.invalidModelName";
	}
	return undefined;
}
