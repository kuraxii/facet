/**
 * facet 的结构化请求桥。
 *
 * facet 在扩展的 ctx.ui 上提供 askForm：一次提交整组题目，返回逐题答案。
 * 这里只做形状转换，校验、模型可见文本与错误码仍由本扩展负责。
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { QuestionAnswer, QuestionData, QuestionnaireResult } from "./schema.ts";

/** facet 侧的一道题。 */
interface FacetQuestion {
	id: string;
	title: string;
	header?: string;
	body?: string;
	multiple?: boolean;
	allowCustom?: boolean;
	choices: FacetChoice[];
}

/** facet 侧的一个选项。 */
interface FacetChoice {
	label: string;
	description?: string;
	preview?: string;
}

/** facet 侧的一道答案。 */
interface FacetAnswer {
	id: string;
	selections: string[];
	custom?: string;
	comment?: string;
}

/** facet 注入到 ctx.ui 上的方法。 */
interface FacetUi {
	askForm?(questions: FacetQuestion[], opts?: { signal?: AbortSignal }): Promise<FacetAnswer[] | undefined>;
}

function toFacetQuestion(question: QuestionData, index: number): FacetQuestion {
	return {
		id: `q${index}`,
		title: question.question,
		header: question.header,
		...(question.multiSelect ? { multiple: true } : {}),
		allowCustom: true,
		choices: question.options.map((option) => ({
			label: option.label,
			description: option.description,
			...(option.preview === undefined ? {} : { preview: option.preview }),
		})),
	};
}

function toAnswer(
	question: QuestionData,
	questionIndex: number,
	answer: FacetAnswer | undefined,
): QuestionAnswer | undefined {
	if (answer === undefined) return undefined;
	const labels = new Set(question.options.map((option) => option.label));
	const selections = answer.selections.filter((label) => labels.has(label));
	const custom = answer.custom?.trim() ?? "";
	const notes = answer.comment?.trim() ?? "";
	if (selections.length === 0 && custom.length === 0) return undefined;
	const base = {
		questionIndex,
		question: question.question,
		...(notes.length === 0 ? {} : { notes }),
	};
	if (question.multiSelect) {
		return {
			...base,
			kind: "multi",
			answer: custom.length === 0 ? null : custom,
			...(selections.length === 0 ? {} : { selected: selections }),
		};
	}
	if (custom.length > 0) {
		return { ...base, kind: "custom", answer: custom };
	}
	const selected = question.options.find((option) => option.label === selections[0]);
	return {
		...base,
		kind: "option",
		answer: selected?.label ?? selections[0] ?? null,
		...(selected?.preview === undefined ? {} : { preview: selected.preview }),
	};
}

/** 返回 undefined 表示宿主没有结构化接口；取消返回 cancelled。 */
export async function askFacet(
	ctx: ExtensionContext,
	questions: readonly QuestionData[],
	signal?: AbortSignal,
): Promise<QuestionnaireResult | undefined> {
	const ui = ctx.ui as unknown as FacetUi;
	if (typeof ui.askForm !== "function") return undefined;
	const form = await ui.askForm(
		questions.map(toFacetQuestion),
		signal === undefined ? undefined : { signal },
	);
	if (form === undefined) return { answers: [], cancelled: true };
	const answers = questions.flatMap((question, index) => {
		const answer = toAnswer(
			question,
			index,
			form.find((item) => item.id === `q${index}`),
		);
		return answer === undefined ? [] : [answer];
	});
	return { answers, cancelled: false };
}
