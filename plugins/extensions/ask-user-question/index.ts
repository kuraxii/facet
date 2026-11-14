/**
 * facet 适配的 ask_user_question 扩展。
 *
 * 参数 schema、prompt 文案、校验与模型可见结果来自 @juicesharp/rpiv-ask-user-question
 * （MIT，Copyright (c) 2026 juicesharp）；界面走 facet 的结构化请求，不包含 rpiv 的 TUI。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildQuestionnaireResponse, buildToolResult } from "./envelope.ts";
import { askFacet } from "./facet.ts";
import { normalizeQuestionParams, prepareQuestionArguments } from "./normalize.ts";
import {
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	type QuestionParams,
	QuestionParamsSchema,
} from "./schema.ts";
import { validateQuestionnaire } from "./validate.ts";

/** 工具名；promptGuidelines 与用户习惯都按这个名字写。 */
export const TOOL_NAME = "ask_user_question";

const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";
const ERROR_NO_CUSTOM_UI =
	"Error: this client cannot render the questionnaire. The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, without using this tool.";

export const DEFAULT_PROMPT_SNIPPET = `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`;

export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	`Use ask_user_question whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to ${MAX_QUESTIONS} questions per invocation.`,
	`Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer via the automatically appended "Type something." row on every question, or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.`,
	`Set multiSelect: true when multiple answers are valid. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. The "Type something." row is appended to every question; in preview mode it expands to the full pane width while typing so the custom answer is not cramped into the narrow options column. If you recommend a specific option, make that the first option and append "(Recommended)" to its label.`,
	"Do not stack multiple ask_user_question calls back-to-back — group all clarifying questions into one invocation.",
];

export const DEFAULT_TOOL_DESCRIPTION = `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users can type a custom answer via the automatically appended "Type something." row on every question or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.
- Use multiSelect: true when multiple answers are valid. The "Type something." row is available on every question, including when options carry a \`preview\`; in preview mode it expands to the full pane width while typing so the custom answer is not cramped into the narrow options column.
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).`;

export function facetAskUserQuestion(pi: ExtensionAPI): void {
	pi.registerTool({
		name: TOOL_NAME,
		label: "Ask User Question",
		description: DEFAULT_TOOL_DESCRIPTION,
		promptSnippet: DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: DEFAULT_PROMPT_GUIDELINES,
		parameters: QuestionParamsSchema,
		exposure: "model-only",
		prepareArguments: prepareQuestionArguments,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return buildToolResult(ERROR_NO_UI, { answers: [], cancelled: true, error: "no_ui" });
			}
			const typed = normalizeQuestionParams(params as QuestionParams);
			const validation = validateQuestionnaire(typed);
			if (!validation.ok) {
				return buildToolResult(validation.message, {
					answers: [],
					cancelled: true,
					error: validation.error,
				});
			}
			const result = await askFacet(ctx, typed.questions, signal);
			if (result === undefined) {
				return buildToolResult(ERROR_NO_CUSTOM_UI, {
					answers: [],
					cancelled: true,
					error: "no_custom_ui",
				});
			}
			return buildQuestionnaireResponse(result, typed);
		},
	});
}

export default facetAskUserQuestion;
