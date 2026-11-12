/**
 * 文件查看与编辑。
 *
 * 只读与编辑两态：进入编辑后才允许改动，`Mod-s` 或保存按钮写回磁盘，写之前带上下载时拿到
 * 的 revision。磁盘上的内容在别处被改过时主机回冲突，这里给出「重新加载」与「覆盖」两个
 * 选择，改动先留在编辑器里。
 */
import type { FileContent } from "@facet/protocol";
import { ArrowLeft, Check, Pencil, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { CodeSurface } from "./code-surface.tsx";

/** 写回的结果。 */
export interface FileSaveResult {
	/** 写完之后的摘要 */
	revision: string;
	/** 写完之后的修改时间，Unix 毫秒 */
	modifiedAt: number;
}

export interface FileViewProps {
	/** 相对项目根的路径 */
	path: string;
	/** 读到的内容；只有文本会进编辑器 */
	content: FileContent;
	/** 返回目录 */
	onClose: () => void;
	/** 写回磁盘；内容冲突时抛出的错误带 conflict 标记 */
	onSave: (text: string, expectedRevision: string) => Promise<FileSaveResult>;
	/** 重新从磁盘读取 */
	onReload: () => Promise<FileContent>;
}

/** 保存失败时用来判断是不是冲突。 */
function isConflict(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && (error as { code?: unknown }).code === "file_conflict"
	);
}

export function FileView({ path, content, onClose, onSave, onReload }: FileViewProps) {
	/** 编辑器里的当前内容 */
	const [draft, setDraft] = useState(content.kind === "text" ? content.content : "");
	/** 磁盘上那份内容，用来判断有没有改动 */
	const [baseline, setBaseline] = useState(content.kind === "text" ? content.content : "");
	/** 是否处于编辑态 */
	const [isEditing, setIsEditing] = useState(false);
	/** 最近一次从磁盘拿到的内容摘要，写回时带上 */
	const [revision, setRevision] = useState(content.kind === "text" ? content.revision : "");
	/** 正在写盘 */
	const [isSaving, setIsSaving] = useState(false);
	/** 写盘失败的原因 */
	const [saveError, setSaveError] = useState<string | undefined>(undefined);
	/** 磁盘上的内容被别处改过 */
	const [hasConflict, setHasConflict] = useState(false);
	/** 刚保存成功，短暂把按钮换成对勾 */
	const [isSaved, setIsSaved] = useState(false);

	// 换文件或重新读到内容时重置整个视图
	useEffect(() => {
		setDraft(content.kind === "text" ? content.content : "");
		setBaseline(content.kind === "text" ? content.content : "");
		setRevision(content.kind === "text" ? content.revision : "");
		setIsEditing(false);
		setSaveError(undefined);
		setHasConflict(false);
	}, [content]);

	useEffect(() => {
		if (!isSaved) {
			return;
		}
		const timer = setTimeout(() => setIsSaved(false), 1200);
		return () => clearTimeout(timer);
	}, [isSaved]);

	const isDirty = content.kind === "text" && draft !== baseline;

	/** 写回磁盘。冲突与其它失败分开处理，冲突时给两个选择。 */
	const save = useCallback(async (): Promise<void> => {
		if (content.kind !== "text" || isSaving) {
			return;
		}
		setIsSaving(true);
		setSaveError(undefined);
		try {
			const result = await onSave(draft, revision);
			setRevision(result.revision);
			setBaseline(draft);
			setIsSaved(true);
		} catch (error) {
			if (isConflict(error)) {
				setHasConflict(true);
			} else {
				setSaveError(error instanceof Error ? error.message : String(error));
			}
		} finally {
			setIsSaving(false);
		}
	}, [content.kind, draft, isSaving, onSave, revision]);

	/** 重新加载：丢掉编辑器里的改动，回到磁盘上的内容。 */
	const reload = useCallback(async (): Promise<void> => {
		try {
			const next = await onReload();
			if (next.kind === "text") {
				setDraft(next.content);
				setBaseline(next.content);
				setRevision(next.revision);
				setHasConflict(false);
				setSaveError(undefined);
			}
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error));
		}
	}, [onReload]);

	/** 覆盖：先用磁盘上的最新摘要，再把编辑器里的内容写回去。 */
	const overwrite = useCallback(async (): Promise<void> => {
		try {
			const next = await onReload();
			if (next.kind !== "text") {
				return;
			}
			setRevision(next.revision);
			const result = await onSave(draft, next.revision);
			setRevision(result.revision);
			setBaseline(draft);
			setHasConflict(false);
			setIsSaved(true);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error));
		}
	}, [draft, onReload, onSave]);

	const isText = content.kind === "text";

	return (
		<div className="file-view">
			<div className="file-head">
				<button type="button" className="ib" aria-label="返回目录" title="返回目录" onClick={onClose}>
					<ArrowLeft size={14} strokeWidth={1.5} />
				</button>
				<span className="file-path" title={path}>
					{path}
				</span>
				{isDirty ? <span className="file-dirty" role="status" title="有未保存的改动" /> : null}
				{isText && !isEditing ? (
					<button
						type="button"
						className="ib"
						aria-label="编辑"
						title="编辑"
						onClick={() => {
							setIsEditing(true);
						}}
					>
						<Pencil size={14} strokeWidth={1.5} />
					</button>
				) : null}
				{isEditing ? (
					<>
						<button
							type="button"
							className="ib"
							aria-label="保存"
							title="保存（Mod+S）"
							disabled={!isDirty || isSaving}
							onClick={() => void save()}
						>
							{isSaved ? <Check size={14} strokeWidth={1.5} /> : <span className="file-save">保存</span>}
						</button>
						<button
							type="button"
							className="ib"
							aria-label="退出编辑"
							title="退出编辑"
							onClick={() => {
								setDraft(baseline);
								setIsEditing(false);
								setHasConflict(false);
								setSaveError(undefined);
							}}
						>
							<X size={14} strokeWidth={1.5} />
						</button>
					</>
				) : null}
			</div>
			{hasConflict ? (
				<p className="chg-note is-error">
					文件已在磁盘上改动。
					<button type="button" className="chg-retry" onClick={() => void reload()}>
						重新加载
					</button>
					<button type="button" className="chg-retry" onClick={() => void overwrite()}>
						覆盖
					</button>
				</p>
			) : null}
			{saveError === undefined ? null : <p className="chg-note is-error">{saveError}</p>}
			{isText ? (
				<CodeSurface
					text={draft}
					path={path}
					readOnly={!isEditing}
					onChange={setDraft}
					onSaveShortcut={() => void save()}
				/>
			) : (
				<p className="chg-note">{content.kind === "binary" ? "二进制文件，不预览" : "文件太大，不预览"}</p>
			)}
		</div>
	);
}
