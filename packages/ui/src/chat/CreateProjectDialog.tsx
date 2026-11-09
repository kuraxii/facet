/**
 * 创建项目。
 *
 * 居中的对话框：填写名称，用系统文件管理器选目录，提交后由宿主写入项目清单。
 */
import { useEffect, useRef, useState } from "react";
import { CloseIcon, FolderIcon, FolderPlusIcon } from "../transcript/icons.tsx";

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

	// 每次打开都从空白开始
	useEffect(() => {
		if (isOpen) {
			setName("");
			setCwd(undefined);
			setIsNameFocused(false);
			setIsPicking(false);
			setIsSubmitting(false);
			setError(undefined);
			nameRef.current?.focus();
		}
	}, [isOpen]);

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
			onClose();
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen, onClose]);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [isOpen, onClose]);

	if (!isOpen) {
		return null;
	}

	const pickFolder = async () => {
		setIsPicking(true);
		setError(undefined);
		try {
			const picked = await onPickFolder();
			if (picked !== undefined) {
				setCwd(picked);
			}
		} catch (pickError) {
			setError(pickError instanceof Error ? pickError.message : String(pickError));
		} finally {
			setIsPicking(false);
		}
	};

	const submit = async () => {
		if (cwd === undefined || isSubmitting) {
			return;
		}
		setIsSubmitting(true);
		setError(undefined);
		try {
			const trimmed = name.trim();
			await onCreate({ cwd, name: trimmed.length > 0 ? trimmed : undefined });
			onClose();
		} catch (createError) {
			setError(createError instanceof Error ? createError.message : String(createError));
		} finally {
			setIsSubmitting(false);
		}
	};

	return (
		<div className="dialog-backdrop">
			<div ref={cardRef} className="dialog" role="dialog" aria-modal="true" aria-label="创建项目">
				<div className="dialog-head">
					<h2 className="dialog-title">创建项目</h2>
					<button type="button" className="dialog-close" aria-label="关闭" onClick={onClose}>
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
						<FolderPlusIcon size={14} />
						{isPicking ? "选择中…" : "添加"}
					</button>
				</div>

				{error === undefined ? null : <p className="dialog-error">{error}</p>}

				<div className="dialog-actions">
					<button type="button" className="dialog-cancel" onClick={onClose}>
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
