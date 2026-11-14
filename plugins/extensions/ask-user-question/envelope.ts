/**
 * 模型可见的工具结果。
 *
 * 取自 @juicesharp/rpiv-ask-user-question 的 tool/format-answer.ts 与
 * tool/response-envelope.ts（MIT，Copyright (c) 2026 juicesharp）。
 */
import type { QuestionAnswer, QuestionnaireResult, QuestionParams } from "./schema.ts";

/** 没有可用答案时的占位。 */
export const NO_INPUT_PLACEHOLDER = "(no input)";
export const DECLINE_MESSAGE = "User declined to answer questions";
export const ENVELOPE_PREFIX = "User has answered your questions:";
export const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";

/** 把答案转成 envelope 里的标量文字。 */
export function formatAnswerScalar(answer: QuestionAnswer): string {
	switch (answer.kind) {
		case "multi": {
			const values = [...(answer.selected ?? [])];
			if (answer.answer && answer.answer.length > 0) values.push(answer.answer);
			return values.length > 0 ? values.join(", ") : NO_INPUT_PLACEHOLDER;
		}
		case "custom":
			return answer.answer && answer.answer.length > 0 ? answer.answer : NO_INPUT_PLACEHOLDER;
		case "option":
			return answer.answer ?? NO_INPUT_PLACEHOLDER;
	}
}

export function buildAnswerSegment(answer: QuestionAnswer): string {
	const parts: string[] = [`"${answer.question}"="${formatAnswerScalar(answer)}"`];
	if (answer.preview && answer.preview.length > 0) parts.push(`selected preview: ${answer.preview}`);
	if (answer.notes && answer.notes.length > 0) parts.push(`user notes: ${answer.notes}`);
	return `${parts.join(". ")}.`;
}

export function buildUnansweredSegment(indexes: readonly number[], params: QuestionParams): string {
	return `unanswered: ${indexes.map((index) => `"${params.questions[index]?.question}"`).join(", ")}.`;
}

export function buildToolResult(text: string, details: QuestionnaireResult) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}

/** 取消与「没有任何答案」都收敛成同一句拒绝。 */
export function buildQuestionnaireResponse(
	result: QuestionnaireResult | null | undefined,
	params: QuestionParams,
) {
	if (!result || result.cancelled) {
		return buildToolResult(DECLINE_MESSAGE, {
			answers: result?.answers ?? [],
			cancelled: true,
			...(result?.globalNote && result.globalNote.length > 0 ? { globalNote: result.globalNote } : {}),
		});
	}
	const segments: string[] = [];
	const unanswered: number[] = [];
	for (let index = 0; index < params.questions.length; index++) {
		const answer = result.answers.find((item) => item.questionIndex === index);
		if (answer) segments.push(buildAnswerSegment(answer));
		else unanswered.push(index);
	}
	const hasGlobalNote = result.globalNote !== undefined && result.globalNote.length > 0;
	if (segments.length === 0 && !hasGlobalNote) {
		return buildToolResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
	}
	if (unanswered.length > 0) segments.push(buildUnansweredSegment(unanswered, params));
	if (hasGlobalNote) segments.push(`global note: ${result.globalNote}.`);
	const details = unanswered.length > 0 ? { ...result, unanswered } : result;
	return buildToolResult(`${ENVELOPE_PREFIX} ${segments.join(" ")} ${ENVELOPE_SUFFIX}`, details);
}
