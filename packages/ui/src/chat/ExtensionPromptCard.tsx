/** 扩展交互卡片；贴在输入区上方，选项按单选列表展示。 */
import type { UiPrompt, UiResponse } from "@facet/protocol";
import { Check, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";

/** 卡片参数。 */
export interface ExtensionPromptCardProps {
	/** 当前会话最早的一条待答请求。 */
	prompt: UiPrompt;
	/** 连接在线且具有操作权限时为 true。 */
	canRespond: boolean;
	/** 向请求所属的会话提交应答。 */
	onRespond: (response: UiResponse) => Promise<void>;
}

/** 把扩展给的标题拆成一行为主、其余为正文；正文保留换行。 */
function splitTitle(title: string): { heading: string; body?: string } {
	const lines = title.split(/\n{2,}/);
	const heading = lines[0]?.trim() ?? "";
	const body = lines.slice(1).join("\n\n").trim();
	return body.length > 0 ? { heading, body } : { heading };
}

export function ExtensionPromptCard({ prompt, canRespond, onRespond }: ExtensionPromptCardProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const submitRef = useRef<HTMLButtonElement>(null);
	const active = useRef(false);
	const submitting = useRef(false);
	const groupName = useId();
	const [value, setValue] = useState(prompt.kind === "editor" ? (prompt.prefill ?? "") : "");
	const [selected, setSelected] = useState<number | undefined>(undefined);
	const [submission, setSubmission] = useState<"idle" | "sending">("idle");
	const [error, setError] = useState<string>();
	const options = prompt.kind === "select" ? [...new Set(prompt.options)] : [];
	const { heading, body } = splitTitle(prompt.title);
	const busy = submission === "sending";

	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);

	// 卡片出现时把焦点放到第一个可操作项。
	useEffect(() => {
		if (!canRespond) return;
		if (prompt.kind === "select") {
			inputRef.current?.focus();
		} else if (prompt.kind === "input") {
			inputRef.current?.focus();
		} else if (prompt.kind === "editor") {
			editorRef.current?.focus();
		} else {
			submitRef.current?.focus();
		}
	}, [canRespond, prompt.kind]);

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

	function submit(): void {
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

	if (!canRespond) {
		return (
			<section className="extension-card is-preview" aria-label={prompt.title}>
				<div className="extension-card-text">
					<h3 className="extension-card-heading">{heading}</h3>
					{body === undefined ? null : <p className="extension-card-body">{body}</p>}
					{prompt.kind === "confirm" ? <p className="extension-card-body">{prompt.message}</p> : null}
					{prompt.kind === "select" ? (
						<ul className="extension-options" aria-label={prompt.title}>
							{options.map((option) => (
								<li key={option} className="extension-option is-preview">
									<span className="extension-radio" aria-hidden="true" />
									<span className="extension-option-label">{option}</span>
								</li>
							))}
						</ul>
					) : null}
					{prompt.kind === "editor" ? (
						<pre className="extension-card-prefill">{prompt.prefill ?? ""}</pre>
					) : null}
				</div>
			</section>
		);
	}

	return (
		<section className="extension-card" aria-busy={busy}>
			<div className="extension-card-text">
				<h3 className="extension-card-heading">{heading}</h3>
				{body === undefined ? null : <p className="extension-card-body">{body}</p>}
				{prompt.kind === "confirm" ? <p className="extension-card-body">{prompt.message}</p> : null}
			</div>
			{prompt.kind === "select" ? (
				<div className="extension-options" role="radiogroup" aria-label={prompt.title}>
					{options.map((option, index) => (
						<label key={option} className="extension-option">
							<input
								ref={index === 0 ? inputRef : undefined}
								type="radio"
								name={groupName}
								className="extension-radio-input"
								checked={selected === index}
								disabled={busy}
								onChange={() => setSelected(index)}
							/>
							<span className="extension-radio" aria-hidden="true">
								{selected === index ? <span className="extension-radio-dot" /> : null}
							</span>
							<span className="extension-option-label">{option}</span>
						</label>
					))}
				</div>
			) : null}
			{prompt.kind === "input" ? (
				<input
					ref={inputRef}
					className="extension-input"
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
					className="extension-input extension-editor mono"
					aria-label={prompt.title}
					value={value}
					disabled={busy}
					onChange={(event) => setValue(event.target.value)}
				/>
			) : null}
			{error === undefined ? null : (
				<p className="extension-card-error" role="alert">
					{error}
				</p>
			)}
			<div className="extension-actions">
				<button
					type="button"
					className="extension-action"
					disabled={busy}
					onClick={() => {
						void respond({ kind: "cancel" });
					}}
				>
					<X size={14} strokeWidth={1.5} aria-hidden="true" />
					<span>关闭</span>
				</button>
				<button
					ref={submitRef}
					type="button"
					className="extension-action is-primary"
					disabled={!canSubmit}
					onClick={submit}
				>
					<Check size={14} strokeWidth={1.5} aria-hidden="true" />
					<span>提交</span>
				</button>
			</div>
		</section>
	);
}
