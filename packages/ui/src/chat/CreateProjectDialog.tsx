/**
 * 创建项目。
 *
 * 居中的对话框：填写名称，用系统文件管理器选目录，提交后由宿主写入项目清单。
 */

import { FolderPlus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CloseIcon, FolderIcon } from "../transcript/icons.tsx";
import { RequestEpoch } from "./request-epoch.ts";

/** 对话框参数。 */
export interface CreateProjectDialogProps {
	/** 是否打开 */
	isOpen: boolean;
	/** 调起文件管理器选择目录，取消时返回空 */
	onPickFolder: () => Promise<string | undefined>;
	/** 提交创建，失败时抛错，错误信息显示在对话框里 */
	onCreate: (input: { cwd: string; name: string | undefined }) => Promise<void>;
	/** 关闭对话框 */
	onClose: () => void;
}

export function CreateProjectDialog({ isOpen, onPickFolder, onCreate, onClose }: CreateProjectDialogProps) {
	const [name, setName] = useState("");
	const [cwd, setCwd] = useState<string | undefined>(undefined);
	const [isNameFocused, setIsNameFocused] = useState(false);
	const [isPicking, setIsPicking] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);
	const nameRef = useRef<HTMLInputElement>(null);
	const cardRef = useRef<HTMLDivElement>(null);
	/** 本次打开的轮次，关闭或重开都会推进它 */
	const epoch = useRef(new RequestEpoch());

	// 每次打开都从空白开始，并换一个新的轮次
	useEffect(() => {
		if (isOpen) {
			epoch.current.advance();
			setName("");
			setCwd(undefined);
			setIsNameFocused(false);
			setIsPicking(false);
			setIsSubmitting(false);
			setError(undefined);
			nameRef.current?.focus();
		}
	}, [isOpen]);

	/** 关闭并作废在途请求。 */
	const close = useCallback(() => {
		epoch.current.advance();
		onClose();
	}, [onClose]);

	// 点对话框外面关闭
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent) => {
			const card = cardRef.current;
			if (card !== null && event.target instanceof Node && card.contains(event.target)) {
				return;
			}
			close();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen, close]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				close();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [isOpen, close]);

	if (!isOpen) {
		return null;
	}

	const pickFolder = async () => {
		const mine = epoch.current.advance();
		setIsPicking(true);
		setError(undefined);
		try {
			const picked = await onPickFolder();
			if (epoch.current.matches(mine) && picked !== undefined) {
				setCwd(picked);
			}
		} catch (pickError) {
			if (epoch.current.matches(mine)) {
				setError(pickError instanceof Error ? pickError.message : String(pickError));
			}
		} finally {
			if (epoch.current.matches(mine)) {
				setIsPicking(false);
			}
		}
	};

	/**
	 * 提交。
	 *
	 * 成功后只在轮次未变时关掉窗口：等待期间关掉又重开时，这次结果属于上一个对话框。
	 * 失败时错误只写回发起它的那一次。
	 */
	const submit = async () => {
		if (cwd === undefined || isSubmitting) {
			return;
		}
		const mine = epoch.current.advance();
		setIsSubmitting(true);
		setError(undefined);
		try {
			const trimmed = name.trim();
			await onCreate({ cwd, name: trimmed.length > 0 ? trimmed : undefined });
			if (epoch.current.matches(mine)) {
				close();
			}
		} catch (createError) {
			if (epoch.current.matches(mine)) {
				setError(createError instanceof Error ? createError.message : String(createError));
			}
		} finally {
			if (epoch.current.matches(mine)) {
				setIsSubmitting(false);
			}
		}
	};

	return (
		<div className="dialog-backdrop">
			<div ref={cardRef} className="dialog" role="dialog" aria-modal="true" aria-label="创建项目">
				<div className="dialog-head">
					<h2 className="dialog-title">创建项目</h2>
					<button type="button" className="dialog-close" aria-label="关闭" onClick={close}>
						<CloseIcon size={18} />
					</button>
				</div>

				<label className={isNameFocused ? "project-field is-focused" : "project-field"}>
					<FolderIcon size={18} />
					<span className="name-divider" />
					<input
						ref={nameRef}
						className="project-name"
						value={name}
						onChange={(event) => setName(event.target.value)}
						onFocus={() => setIsNameFocused(true)}
						onBlur={() => setIsNameFocused(false)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								void submit();
							}
						}}
						placeholder="项目名称"
						aria-label="项目名称"
					/>
				</label>

				<p className="dialog-label">源文件夹</p>
				<div className="source-box">
					{cwd === undefined ? (
						<span className="source-hint">
							在此电脑上添加文件夹
							<i className="chev is-open" />
						</span>
					) : (
						<span className="source-path mono" title={cwd}>
							{cwd}
						</span>
					)}
					<button type="button" className="source-add" onClick={() => void pickFolder()} disabled={isPicking}>
						<FolderPlus size={14} strokeWidth={1.5} />
						{isPicking ? "选择中…" : "添加"}
					</button>
				</div>

				{error === undefined ? null : <p className="dialog-error">{error}</p>}

				<div className="dialog-actions">
					<button type="button" className="dialog-cancel" onClick={close}>
						取消
					</button>
					<button
						type="button"
						className="dialog-primary"
						onClick={() => void submit()}
						disabled={cwd === undefined || isSubmitting}
					>
						{isSubmitting ? "创建中…" : "创建项目"}
					</button>
				</div>
			</div>
		</div>
	);
}
