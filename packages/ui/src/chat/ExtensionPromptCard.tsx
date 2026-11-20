/** 扩展交互卡片；贴在输入区上方，选择为单选列表，结构化请求带题目标签页。 */
import type { UiFormAnswer, UiFormQuestion, UiPrompt, UiResponse } from "@facet/protocol";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import styles from "./ExtensionPromptCard.module.css";

/** 源类名到模块类名的映射，状态类也在这里集中命名。 */
const s = {
	card: styles["extension-card"],
	cardPreview: styles["is-preview"],
	cardText: styles["extension-card-text"],
	heading: styles["extension-card-heading"],
	body: styles["extension-card-body"],
	chip: styles["extension-chip"],
	preview: styles["extension-preview"],
	prefill: styles["extension-card-prefill"],
	options: styles["extension-options"],
	option: styles["extension-option"],
	optionPreview: styles["is-preview"],
	radioInput: styles["extension-radio-input"],
	radio: styles["extension-radio"],
	radioDot: styles["extension-radio-dot"],
	optionText: styles["extension-option-text"],
	optionLabel: styles["extension-option-label"],
	placeholder: styles["is-placeholder"],
	custom: styles["is-custom"],
	editing: styles["is-editing"],
	customInput: styles["extension-custom-input"],
	optionNote: styles["extension-option-note"],
	square: styles["is-square"],
	tabs: styles["extension-tabs"],
	tab: styles["extension-tab"],
	tabActive: styles["is-active"],
	tabMark: styles["extension-tab-mark"],
	tabDot: styles["extension-tab-dot"],
	formPreview: styles["extension-form-preview"],
	input: styles["extension-input"],
	editor: styles["extension-editor"],
	error: styles["extension-card-error"],
	footer: styles["extension-footer"],
	actions: styles["extension-actions"],
	action: styles["extension-action"],
	actionPrimary: styles["is-primary"],
};

/** 卡片参数。 */
export interface ExtensionPromptCardProps {
	/** 当前会话最早的一条待答请求。 */
	prompt: UiPrompt;
	/** 连接在线且具有操作权限时为 true。 */
	canRespond: boolean;
	/** 向请求所属的会话提交应答。 */
	onRespond: (response: UiResponse) => Promise<void>;
}

/** 一道题的编辑状态。 */
interface FormAnswerState {
	/** 当前选中的选项文字。 */
	selections: string[];
	/** 选项之外的自定义答案。 */
	custom: string;
	/** 备注原文。 */
	comment: string;
}

/** 把扩展给的标题拆成一行为主、其余为正文；正文保留换行。 */
function splitTitle(title: string): { heading: string; body?: string } {
	const lines = title.split(/\n{2,}/);
	const heading = lines[0]?.trim() ?? "";
	const body = lines.slice(1).join("\n\n").trim();
	return body.length > 0 ? { heading, body } : { heading };
}

function initialAnswers(questions: UiFormQuestion[]): FormAnswerState[] {
	return questions.map(() => ({ selections: [], custom: "", comment: "" }));
}

function answersFor(questions: UiFormQuestion[], states: FormAnswerState[]): UiFormAnswer[] {
	return questions.map((question, index) => {
		const state = states[index] ?? { selections: [], custom: "", comment: "" };
		const custom = state.custom.trim();
		const comment = state.comment.trim();
		return {
			id: question.id,
			selections: state.selections,
			...(custom.length === 0 ? {} : { custom }),
			...(comment.length === 0 ? {} : { comment }),
		};
	});
}

export function ExtensionPromptCard({ prompt, canRespond, onRespond }: ExtensionPromptCardProps) {
	const { t } = useI18n();
	const cardRef = useRef<HTMLElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const submitRef = useRef<HTMLButtonElement>(null);
	const tablistRef = useRef<HTMLDivElement>(null);
	const active = useRef(false);
	const submitting = useRef(false);
	const groupName = useId();
	const [value, setValue] = useState(prompt.kind === "editor" ? (prompt.prefill ?? "") : "");
	const [selected, setSelected] = useState<number | undefined>(undefined);
	const [tab, setTab] = useState(0);
	const [customEditing, setCustomEditing] = useState<number | undefined>(undefined);
	const customRef = useRef<HTMLInputElement>(null);
	const [formAnswers, setFormAnswers] = useState<FormAnswerState[]>(() =>
		prompt.kind === "form" ? initialAnswers(prompt.questions) : [],
	);
	const [submission, setSubmission] = useState<"idle" | "sending">("idle");
	const [error, setError] = useState<string>();
	const options = prompt.kind === "select" ? [...new Set(prompt.options)] : [];
	const questions = prompt.kind === "form" ? prompt.questions : [];
	const question = questions[tab];
	const answer = formAnswers[tab];
	const { heading, body } = splitTitle(prompt.kind === "form" ? (question?.title ?? "") : prompt.title);
	const busy = submission === "sending";
	const hasCustom = (answer?.custom.trim().length ?? 0) > 0;
	const customActive = question?.allowCustom === true && (hasCustom || customEditing === tab);
	const preview =
		question?.choices.find((choice) => answer?.selections.includes(choice.label))?.preview ??
		question?.choices[0]?.preview;

	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);

	// 卡片出现时把焦点放到第一个可操作项。
	useEffect(() => {
		if (!canRespond) return;
		if (prompt.kind === "select" || prompt.kind === "input") {
			inputRef.current?.focus();
		} else if (prompt.kind === "editor") {
			editorRef.current?.focus();
		} else if (prompt.kind === "form") {
			cardRef.current?.querySelector<HTMLInputElement>("input[type=radio], input[type=checkbox]")?.focus();
		} else {
			submitRef.current?.focus();
		}
	}, [canRespond, prompt.kind]);

	// 自定义答案行展开后把焦点交给输入框。
	useEffect(() => {
		if (customEditing === tab) customRef.current?.focus();
	}, [customEditing, tab]);

	const respond = useCallback(
		async (response: UiResponse): Promise<void> => {
			if (!canRespond || submitting.current) return;
			submitting.current = true;
			setSubmission("sending");
			setError(undefined);
			try {
				await onRespond(response);
			} catch (failure) {
				if (!active.current) return;
				setError(failure instanceof Error ? failure.message : String(failure));
				submitting.current = false;
				setSubmission("idle");
			}
		},
		[canRespond, onRespond],
	);

	// Esc 取消；卡片不是模态，监听放在文档上。
	useEffect(() => {
		if (!canRespond) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			void respond({ kind: "cancel" });
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [canRespond, respond]);

	function updateAnswer(index: number, patch: Partial<FormAnswerState>): void {
		setFormAnswers((current) =>
			current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
		);
	}

	function choose(label: string): void {
		if (question === undefined || answer === undefined) return;
		if (question.multiple) {
			const selections = answer.selections.includes(label)
				? answer.selections.filter((item) => item !== label)
				: [...answer.selections, label];
			updateAnswer(tab, { selections });
			return;
		}
		updateAnswer(tab, { selections: [label], custom: "" });
		setCustomEditing(undefined);
	}

	function submit(): void {
		if (prompt.kind === "form") {
			void respond({ kind: "form", answers: answersFor(prompt.questions, formAnswers) });
			return;
		}
		if (prompt.kind === "select") {
			const choice = selected === undefined ? undefined : options[selected];
			if (choice !== undefined) void respond({ kind: "select", value: choice });
			return;
		}
		if (prompt.kind === "confirm") {
			void respond({ kind: "confirm", confirmed: true });
			return;
		}
		void respond({ kind: prompt.kind, value });
	}

	const canSubmit =
		!busy && (prompt.kind !== "select" || (selected !== undefined && options[selected] !== undefined));

	function moveTab(next: number): void {
		const bounded = Math.max(0, Math.min(questions.length - 1, next));
		setTab(bounded);
		setCustomEditing(undefined);
		tablistRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[bounded]?.focus();
	}

	if (!canRespond) {
		return (
			<section className={`${s.card} ${s.cardPreview}`} aria-label={prompt.title} data-extension-preview-card>
				<div className={s.cardText}>
					{prompt.kind === "form" ? (
						prompt.questions.map((item) => (
							<div key={item.id} className={s.formPreview}>
								{item.header === undefined ? null : <span className={s.chip}>{item.header}</span>}
								<h3 className={s.heading}>{item.title}</h3>
								{item.body === undefined ? null : <p className={s.body}>{item.body}</p>}
								{item.choices.length === 0 ? null : (
									<ul className={s.options} data-extension-options>
										{item.choices.map((choice) => (
											<li key={choice.label} className={`${s.option} ${s.optionPreview}`}>
												<span className={s.radio} aria-hidden="true" />
												<span className={s.optionLabel}>{choice.label}</span>
											</li>
										))}
										{item.allowCustom === true ? (
											<li className={`${s.option} ${s.optionPreview}`}>
												<span className={s.radio} aria-hidden="true" />
												<span className={`${s.optionLabel} ${s.placeholder}`}>
													{t("extension.customPlaceholder")}
												</span>
											</li>
										) : null}
									</ul>
								)}
							</div>
						))
					) : (
						<>
							<h3 className={s.heading}>{heading}</h3>
							{body === undefined ? null : <p className={s.body}>{body}</p>}
							{prompt.kind === "confirm" ? <p className={s.body}>{prompt.message}</p> : null}
							{prompt.kind === "select" ? (
								<ul className={s.options} aria-label={prompt.title} data-extension-options>
									{options.map((option) => (
										<li key={option} className={`${s.option} ${s.optionPreview}`}>
											<span className={s.radio} aria-hidden="true" />
											<span className={s.optionLabel}>{option}</span>
										</li>
									))}
								</ul>
							) : null}
							{prompt.kind === "editor" ? (
								<pre className={`scroll-both ${s.prefill}`}>{prompt.prefill ?? ""}</pre>
							) : null}
						</>
					)}
				</div>
			</section>
		);
	}

	return (
		<section ref={cardRef} className={s.card} aria-busy={busy}>
			{prompt.kind === "form" ? (
				<div
					ref={tablistRef}
					className={s.tabs}
					role="tablist"
					aria-label={t("extension.questions")}
					onKeyDown={(event) => {
						if (event.key === "ArrowLeft") {
							event.preventDefault();
							moveTab(tab - 1);
						} else if (event.key === "ArrowRight") {
							event.preventDefault();
							moveTab(tab + 1);
						}
					}}
				>
					{questions.map((item, index) => {
						const state = formAnswers[index];
						const responded = (state?.selections.length ?? 0) > 0 || (state?.custom.trim().length ?? 0) > 0;
						return (
							<button
								key={item.id}
								type="button"
								role="tab"
								aria-selected={tab === index}
								className={`${s.tab}${tab === index ? ` ${s.tabActive}` : ""}`}
								onClick={() => {
									setTab(index);
									setCustomEditing(undefined);
								}}
							>
								<span className={s.tabMark} aria-hidden="true">
									{responded ? (
										<Check size={11} strokeWidth={2} />
									) : (
										<span className={s.tabDot} data-extension-tab-dot />
									)}
								</span>
								<span>{item.header ?? index + 1}</span>
							</button>
						);
					})}
				</div>
			) : null}
			<div className={s.cardText}>
				<h3 className={s.heading}>{heading}</h3>
				{body === undefined ? null : <p className={s.body}>{body}</p>}
				{prompt.kind === "confirm" ? <p className={s.body}>{prompt.message}</p> : null}
			</div>
			{prompt.kind === "select" ? (
				<div className={s.options} role="radiogroup" aria-label={prompt.title} data-extension-options>
					{options.map((option, index) => (
						<label key={option} className={s.option}>
							<input
								ref={index === 0 ? inputRef : undefined}
								type="radio"
								name={groupName}
								className={s.radioInput}
								checked={selected === index}
								disabled={busy}
								onChange={() => setSelected(index)}
							/>
							<span className={s.radio} aria-hidden="true">
								{selected === index ? <span className={s.radioDot} /> : null}
							</span>
							<span className={s.optionLabel}>{option}</span>
						</label>
					))}
				</div>
			) : null}
			{prompt.kind === "form" && question !== undefined ? (
				<>
					<div className={s.options} data-extension-options>
						{question.choices.map((choice) => (
							<label key={choice.label} className={s.option}>
								<input
									type={question.multiple ? "checkbox" : "radio"}
									name={question.multiple ? undefined : `${groupName}-${question.id}`}
									className={s.radioInput}
									checked={answer?.selections.includes(choice.label) === true}
									disabled={busy}
									onChange={() => choose(choice.label)}
									onKeyDown={(event) => {
										if (event.key === "Enter") {
											event.preventDefault();
											submit();
											return;
										}
										if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
										const group = event.currentTarget.closest("[data-extension-options]");
										if (group === null) return;
										const inputs = [...group.querySelectorAll<HTMLInputElement>("input")];
										const current = inputs.indexOf(event.currentTarget);
										if (current < 0) return;
										event.preventDefault();
										const step = event.key === "ArrowDown" ? 1 : -1;
										const target = inputs[(current + step + inputs.length) % inputs.length];
										if (target === undefined) return;
										target.focus();
										if (target.type === "radio") target.click();
									}}
								/>
								<span className={`${s.radio}${question.multiple ? ` ${s.square}` : ""}`} aria-hidden="true">
									{answer?.selections.includes(choice.label) === true ? (
										question.multiple ? (
											<Check size={12} strokeWidth={2.5} />
										) : (
											<span className={s.radioDot} />
										)
									) : null}
								</span>
								<span className={s.optionText}>
									<span className={s.optionLabel}>{choice.label}</span>
									{choice.description === undefined ? null : (
										<span className={s.optionNote}>{choice.description}</span>
									)}
								</span>
							</label>
						))}
						{question.allowCustom === true ? (
							customActive ? (
								<div className={`${s.option} ${s.custom} ${s.editing}`}>
									<span className={`${s.radio}${question.multiple ? ` ${s.square}` : ""}`} aria-hidden="true">
										{hasCustom ? (
											question.multiple ? (
												<Check size={12} strokeWidth={2.5} />
											) : (
												<span className={s.radioDot} />
											)
										) : null}
									</span>
									<input
										ref={customRef}
										className={s.customInput}
										data-extension-custom-input
										aria-label={t("extension.customAnswer", { title: question.title })}
										placeholder={t("extension.customPlaceholder")}
										value={answer?.custom ?? ""}
										disabled={busy}
										onChange={(event) =>
											updateAnswer(tab, {
												custom: event.target.value,
												...(question.multiple ? {} : { selections: [] }),
											})
										}
										onBlur={() => {
											if ((answer?.custom ?? "").trim().length === 0) setCustomEditing(undefined);
										}}
										onKeyDown={(event) => {
											if (event.key === "Escape") {
												event.preventDefault();
												event.stopPropagation();
												setCustomEditing(undefined);
												return;
											}
											if (event.key !== "Enter") return;
											event.preventDefault();
											submit();
										}}
									/>
								</div>
							) : (
								<label className={`${s.option} ${s.custom}`}>
									<input
										type={question.multiple ? "checkbox" : "radio"}
										name={question.multiple ? undefined : `${groupName}-${question.id}`}
										className={s.radioInput}
										checked={false}
										disabled={busy}
										onChange={() => setCustomEditing(tab)}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												setCustomEditing(tab);
											}
										}}
									/>
									<span
										className={`${s.radio}${question.multiple ? ` ${s.square}` : ""}`}
										aria-hidden="true"
									/>
									<span className={`${s.optionLabel} ${s.placeholder}`}>
										{t("extension.customPlaceholder")}
									</span>
								</label>
							)
						) : null}
					</div>
					{customActive || preview === undefined ? null : (
						<pre className={`scroll-both ${s.preview}`} data-extension-preview>
							{preview}
						</pre>
					)}
					<input
						className={s.input}
						aria-label={`${question.title} ${t("extension.note")}`}
						placeholder={t("extension.note")}
						value={answer?.comment ?? ""}
						disabled={busy}
						onChange={(event) => updateAnswer(tab, { comment: event.target.value })}
						onKeyDown={(event) => {
							if (event.key !== "Enter") return;
							event.preventDefault();
							submit();
						}}
					/>
				</>
			) : null}
			{prompt.kind === "input" ? (
				<input
					ref={inputRef}
					className={s.input}
					aria-label={prompt.title}
					placeholder={prompt.placeholder}
					value={value}
					disabled={busy}
					onChange={(event) => setValue(event.target.value)}
				/>
			) : null}
			{prompt.kind === "editor" ? (
				<textarea
					ref={editorRef}
					className={`${s.input} ${s.editor} mono`}
					aria-label={prompt.title}
					value={value}
					disabled={busy}
					onChange={(event) => setValue(event.target.value)}
				/>
			) : null}
			{error === undefined ? null : (
				<p className={s.error} role="alert">
					{error}
				</p>
			)}
			<div className={s.footer}>
				<div className={s.actions} data-extension-actions>
					<button
						type="button"
						className={s.action}
						disabled={busy}
						onClick={() => {
							void respond({ kind: "cancel" });
						}}
					>
						<X size={14} strokeWidth={1.5} aria-hidden="true" />
						<span>{t("extension.close")}</span>
					</button>
					<button
						ref={submitRef}
						type="button"
						className={`${s.action} ${s.actionPrimary}`}
						data-extension-submit
						disabled={!canSubmit}
						onClick={submit}
					>
						<Check size={14} strokeWidth={1.5} aria-hidden="true" />
						<span>{t("extension.submit")}</span>
					</button>
				</div>
			</div>
		</section>
	);
}
