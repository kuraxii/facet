/**
 * 参数 schema 与结果类型。
 *
 * 取自 @juicesharp/rpiv-ask-user-question 的 tool/types.ts（MIT，Copyright (c) 2026 juicesharp），
 * 去掉 TUI 专用的哨兵行定义，保留题目上限、选项上限与模型可见的字段说明。
 */
import { type Static, Type } from "typebox";

/** 一次提问最多包含的题目数。 */
export const MAX_QUESTIONS = 4;
/** 每道题最少的选项数。 */
export const MIN_OPTIONS = 2;
/** 每道题最多的选项数。 */
export const MAX_OPTIONS = 4;
/** 题目标签的最大字符数。 */
export const MAX_HEADER_LENGTH = 16;
/** 选项标签的最大字符数。 */
export const MAX_LABEL_LENGTH = 60;

/** 界面自己生成的行，模型不能把这些文字当作选项。 */
export const RESERVED_LABELS = ["Other", "Type something.", "Next"] as const;

export const OptionSchema = Type.Object({
	label: Type.String({
		maxLength: MAX_LABEL_LENGTH,
		description: `MAX ${MAX_LABEL_LENGTH} CHARACTERS — hard limit, requests over the limit are rejected. The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.`,
	}),
	description: Type.String({
		description:
			"Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
	}),
	preview: Type.Optional(
		Type.String({
			description:
				"Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options.",
		}),
	),
});

export const QuestionSchema = Type.Object({
	question: Type.String({
		description:
			'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
	}),
	header: Type.String({
		maxLength: MAX_HEADER_LENGTH,
		description: `MAX ${MAX_HEADER_LENGTH} CHARACTERS — hard limit, requests over the limit are rejected. Very short chip/tag shown next to the question. Examples: "Auth method", "Library", "Approach".`,
	}),
	options: Type.Array(OptionSchema, {
		minItems: MIN_OPTIONS,
		maxItems: MAX_OPTIONS,
		description:
			"The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). The 'Type something.' row is appended automatically — do NOT author it.",
	}),
	multiSelect: Type.Optional(
		Type.Boolean({
			default: false,
			description:
				"Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
		}),
	),
});

export const QuestionsSchema = Type.Array(QuestionSchema, {
	minItems: 1,
	maxItems: MAX_QUESTIONS,
	description: "Questions to ask the user (1-4 questions)",
});

export const QuestionParamsSchema = Type.Object({
	questions: QuestionsSchema,
});

export type OptionData = Static<typeof OptionSchema>;
export type QuestionData = Static<typeof QuestionSchema>;
export type QuestionParams = Static<typeof QuestionParamsSchema>;

/** 一道题的作答结果。 */
export interface QuestionAnswer {
	/** 题目在请求里的下标。 */
	questionIndex: number;
	/** 题目原文。 */
	question: string;
	/** 答案来源：选项、自定义文本或多选。 */
	kind: "option" | "custom" | "multi";
	/** 单选选中的标签、自定义文本，或多选时的自定义文本。 */
	answer: string | null;
	/** 多选时选中的选项标签。 */
	selected?: string[];
	/** 用户写的备注。 */
	notes?: string;
	/** 选中选项携带的预览内容。 */
	preview?: string;
}

/** 可能出现在结果里的错误码。 */
export type QuestionnaireError =
	| "no_ui"
	| "no_custom_ui"
	| "no_questions"
	| "empty_options"
	| "too_many_questions"
	| "duplicate_question"
	| "duplicate_option_label"
	| "reserved_label";

/** 一次提问的结果。 */
export interface QuestionnaireResult {
	/** 按题目下标排列的答案；未作答的题不出现在这里。 */
	answers: QuestionAnswer[];
	/** 用户是否取消。 */
	cancelled: boolean;
	/** 提交页填写的全局备注。 */
	globalNote?: string;
	/** 部分提交时未作答的题目下标。 */
	unanswered?: number[];
	/** 校验或渲染失败的原因。 */
	error?: QuestionnaireError;
}
