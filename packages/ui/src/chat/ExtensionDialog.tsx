/** 扩展交互的单一弹窗；父级按 requestId 挂载，完成由会话状态关闭。 */
import type { UiPrompt, UiResponse } from "@facet/protocol";
import { Check, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

/** 弹窗参数。 */
export interface ExtensionDialogProps {
	/** 当前会话最早的一条待答请求。 */
	prompt: UiPrompt;
	/** 连接在线且具有操作权限时为 true。 */
	canRespond: boolean;
	/** 向请求所属的会话提交应答。 */
	onRespond: (response: UiResponse) => Promise<void>;
}

/** 选择、确认、单行输入与完整多行编辑共用的原生 modal。 */
export function ExtensionDialog({ prompt, canRespond, onRespond }: ExtensionDialogProps) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const initialRef = useRef<HTMLInputElement>(null);
	const editorRef = useRef<HTMLTextAreaElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const active = useRef(false);
	const submitting = useRef(false);
	const titleId = useId();
	const messageId = useId();
	const [query, setQuery] = useState("");
	const [value, setValue] = useState(prompt.kind === "editor" ? (prompt.prefill ?? "") : "");
	const [selected, setSelected] = useState(prompt.kind === "select" ? prompt.options[0] : undefined);
	const [submission, setSubmission] = useState<"idle" | "sending">("idle");
	const [error, setError] = useState<string>();
	const options =
		prompt.kind === "select"
			? prompt.options.filter((option) => option.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
			: [];
	const choice = selected !== undefined && options.includes(selected) ? selected : options[0];

	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);

	useEffect(() => {
		submitting.current = false;
		setSubmission("idle");
		if (!canRespond) return;
		const dialog = dialogRef.current;
		const previous = document.activeElement;
		dialog?.showModal();
		(initialRef.current ?? editorRef.current ?? cancelRef.current)?.focus();
		return () => {
			dialog?.close();
			if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
		};
	}, [canRespond]);

	async function respond(response: UiResponse): Promise<void> {
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
	}

	if (!canRespond) {
		return (
			<section className="extension-preview" aria-label={prompt.title}>
				<h3>{prompt.title}</h3>
				{prompt.kind === "confirm" ? <p>{prompt.message}</p> : null}
				{prompt.kind === "select" ? (
					<select aria-label={prompt.title} disabled>
						{[...new Set(prompt.options)].map((option) => (
							<option key={option}>{option}</option>
						))}
					</select>
				) : null}
				{prompt.kind === "input" ? (
					<input aria-label={prompt.title} placeholder={prompt.placeholder} value="" readOnly />
				) : null}
				{prompt.kind === "editor" ? (
					<textarea aria-label={prompt.title} value={prompt.prefill ?? ""} readOnly />
				) : null}
			</section>
		);
	}

	return (
		<dialog
			ref={dialogRef}
			className="dialog extension-dialog"
			aria-labelledby={titleId}
			aria-describedby={prompt.kind === "confirm" ? messageId : undefined}
			aria-busy={submission === "sending"}
			onCancel={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void respond({ kind: "cancel" });
			}}
		>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					if (prompt.kind === "select") {
						if (choice !== undefined) void respond({ kind: "select", value: choice });
					} else if (prompt.kind === "confirm") {
						void respond({ kind: "confirm", confirmed: true });
					} else {
						void respond({ kind: prompt.kind, value });
					}
				}}
			>
				<div className="dialog-head">
					<h2 className="dialog-title" id={titleId}>
						{prompt.title}
					</h2>
					<button
						type="button"
						className="dialog-close"
						aria-label="关闭"
						disabled={submission === "sending"}
						onClick={() => {
							void respond({ kind: "cancel" });
						}}
					>
						<X size={18} strokeWidth={1.5} />
					</button>
				</div>
				{prompt.kind === "confirm" ? (
					<p id={messageId} className="extension-message">
						{prompt.message}
					</p>
				) : null}
				{prompt.kind === "select" ? (
					<div className="extension-fields">
						<input
							ref={initialRef}
							type="search"
							className="extension-input"
							aria-label="搜索选项"
							value={query}
							disabled={submission === "sending"}
							onChange={(event) => setQuery(event.target.value)}
						/>
						<select
							className="extension-options"
							aria-label={prompt.title}
							size={Math.max(2, Math.min(8, options.length))}
							value={choice ?? ""}
							disabled={submission === "sending"}
							onChange={(event) => setSelected(event.target.value)}
						>
							{[...new Set(options)].map((option) => (
								<option key={option} value={option}>
									{option}
								</option>
							))}
						</select>
					</div>
				) : null}
				{prompt.kind === "input" ? (
					<input
						ref={initialRef}
						className="extension-input"
						aria-label={prompt.title}
						placeholder={prompt.placeholder}
						value={value}
						disabled={submission === "sending"}
						onChange={(event) => setValue(event.target.value)}
					/>
				) : null}
				{prompt.kind === "editor" ? (
					<textarea
						ref={editorRef}
						className="extension-input extension-editor mono"
						aria-label={prompt.title}
						value={value}
						disabled={submission === "sending"}
						onChange={(event) => setValue(event.target.value)}
					/>
				) : null}
				{error === undefined ? null : (
					<p className="dialog-error" role="alert">
						{error}
					</p>
				)}
				<div className="dialog-actions">
					<button
						ref={cancelRef}
						type="button"
						className="dialog-cancel"
						disabled={submission === "sending"}
						onClick={() => {
							void respond({ kind: "cancel" });
						}}
					>
						取消
					</button>
					<button
						type="submit"
						className="dialog-primary"
						disabled={submission === "sending" || (prompt.kind === "select" && choice === undefined)}
						aria-label="确认"
					>
						<Check size={16} strokeWidth={1.5} aria-hidden="true" />
					</button>
				</div>
			</form>
		</dialog>
	);
}
