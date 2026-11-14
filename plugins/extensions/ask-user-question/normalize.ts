/**
 * 参数归一化与预解析。
 *
 * 取自 @juicesharp/rpiv-ask-user-question 的 tool/normalize-params.ts（MIT，Copyright (c) 2026 juicesharp）。
 */
import type { QuestionParams } from "./schema.ts";

/** 把模型误写的裸回车删掉，保留真正的换行。 */
export function normalizeLineTerminators(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "");
}

function normalizeStringFields<T extends object>(obj: T, keys: readonly (keyof T)[]): T {
	const out = { ...obj };
	for (const key of keys) {
		const value = obj[key];
		if (typeof value === "string") out[key] = normalizeLineTerminators(value) as T[typeof key];
	}
	return out;
}

/** 归一化题目、标签、选项文字与预览，校验与界面看到的是同一份文本。 */
export function normalizeQuestionParams(params: QuestionParams): QuestionParams {
	return {
		...params,
		questions: params.questions.map((question) => ({
			...normalizeStringFields(question, ["question", "header"]),
			options: question.options.map((option) =>
				normalizeStringFields(option, ["label", "description", "preview"]),
			),
		})),
	};
}

/** 还原被双重 JSON 编码的 questions 与 options。 */
export function prepareQuestionArguments(args: unknown): QuestionParams {
	if (!isRecord(args)) return args as QuestionParams;
	const questions = decodeArray(args.questions);
	if (!Array.isArray(questions)) return args as QuestionParams;
	const decoded = questions.map((item) => {
		const question = decodeObject(item);
		if (!isRecord(question)) return item;
		const options = decodeArray(question.options);
		return Array.isArray(options) ? { ...question, options: options.map(decodeObject) } : question;
	});
	return { ...args, questions: decoded } as unknown as QuestionParams;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeArray(value: unknown): unknown {
	const parsed = typeof value === "string" ? parseJson(value) : value;
	return Array.isArray(parsed) ? parsed : value;
}

function decodeObject(value: unknown): unknown {
	const parsed = typeof value === "string" ? parseJson(value) : value;
	return isRecord(parsed) ? parsed : value;
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}
