/**
 * 题目校验。
 *
 * 取自 @juicesharp/rpiv-ask-user-question 的 tool/validate-questionnaire.ts（MIT，Copyright (c) 2026 juicesharp）。
 */
import {
	MAX_QUESTIONS,
	MIN_OPTIONS,
	type QuestionnaireError,
	type QuestionParams,
	RESERVED_LABELS,
} from "./schema.ts";

export const ERROR_NO_QUESTIONS = "Error: At least one question is required";
export const ERROR_TOO_MANY_QUESTIONS = `Error: At most ${MAX_QUESTIONS} questions are allowed per invocation`;
export const ERROR_DUPLICATE_QUESTION = "Error: Question text must be unique within an invocation";
export const ERROR_TOO_FEW_OPTIONS = `Error: Each question requires at least ${MIN_OPTIONS} options`;
export const ERROR_RESERVED_LABEL = `Error: Option label is reserved (${RESERVED_LABELS.join(", ")})`;
export const ERROR_DUPLICATE_OPTION_LABEL = "Error: Option labels must be unique within a question";

const RESERVED_LABEL_SET: ReadonlySet<string> = new Set(RESERVED_LABELS);

export type ValidationResult = { ok: true } | { ok: false; error: QuestionnaireError; message: string };

/** 纯函数校验；reserved_label 先于 duplicate_option_label。 */
export function validateQuestionnaire(typed: QuestionParams): ValidationResult {
	if (typed.questions.length === 0) {
		return { ok: false, error: "no_questions", message: ERROR_NO_QUESTIONS };
	}
	if (typed.questions.length > MAX_QUESTIONS) {
		return { ok: false, error: "too_many_questions", message: ERROR_TOO_MANY_QUESTIONS };
	}

	const seenQuestions = new Set<string>();
	for (const question of typed.questions) {
		if (seenQuestions.has(question.question)) {
			return { ok: false, error: "duplicate_question", message: ERROR_DUPLICATE_QUESTION };
		}
		seenQuestions.add(question.question);
	}

	for (const question of typed.questions) {
		if (question.options.length < MIN_OPTIONS) {
			return { ok: false, error: "empty_options", message: ERROR_TOO_FEW_OPTIONS };
		}
		const seenLabels = new Set<string>();
		for (const option of question.options) {
			if (RESERVED_LABEL_SET.has(option.label)) {
				return { ok: false, error: "reserved_label", message: ERROR_RESERVED_LABEL };
			}
			if (seenLabels.has(option.label)) {
				return {
					ok: false,
					error: "duplicate_option_label",
					message: ERROR_DUPLICATE_OPTION_LABEL,
				};
			}
			seenLabels.add(option.label);
		}
	}

	return { ok: true };
}
