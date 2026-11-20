/**
 * 文件查看与编辑。
 *
 * 只读与编辑两态：进入编辑后才允许改动，`Mod-s` 或保存按钮写回磁盘，写之前带上下载时拿到
 * 的 revision。磁盘上的内容在别处被改过时主机回冲突，这里给出「重新加载」与「覆盖」两个
 * 选择，改动先留在编辑器里。
 */
import type { FileContent } from "@facet/protocol";
import { useI18n } from "@facet/ui/i18n";
import { Markdown } from "@facet/ui/markdown";
import { useHoverTip } from "@facet/ui/tip";
import { Check, Code, Eye, Pencil, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { CodeSurface } from "./code-surface.tsx";
import { isMarkdownPath } from "./markdown-file.ts";

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
	/** 写回磁盘；内容冲突时抛出的错误带 conflict 标记 */
	onSave: (text: string, expectedRevision: string) => Promise<FileSaveResult>;
	/** 重新从磁盘读取 */
	onReload: () => Promise<FileContent>;
	/**
	 * 挂在标题行最右端的额外动作。
	 *
	 * 工作区用它放「展开文件树」：树收起之后预览占满，这个入口跟着标题行走，位置固定。
	 */
	headerTrailing?: ReactNode;
}

/** 保存失败时用来判断是不是冲突。 */
function isConflict(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && (error as { code?: unknown }).code === "file_conflict"
	);
}

/** Markdown 文件的两种呈现：渲染后的预览，与可编辑的源码。 */
type MarkdownView = "preview" | "source";

export function FileView({ path, content, onSave, onReload, headerTrailing }: FileViewProps) {
	const { t } = useI18n();
	// 路径被省略号截断时由提示补全
	const tip = useHoverTip();
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
	/**
	 * Markdown 当前是预览还是源码；非 Markdown 文件不看它。初值取一次就够：
	 * 文件标签与文件一一对应，换文件是重挂组件，不靠重置。
	 */
	const [markdownView, setMarkdownView] = useState<MarkdownView>("preview");

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
	/** 能渲染预览的文件：有文本内容，且扩展名是 Markdown */
	const isMarkdown = isText && isMarkdownPath(path);
	/** 正在看渲染结果，没在看看源码 */
	const isPreviewing = isMarkdown && markdownView === "preview";

	return (
		<div className="file-view">
			<div className="file-head">
				<span className="file-path" {...tip.handlers(path)}>
					{path}
				</span>
				{isDirty ? (
					<span className="file-dirty" role="status" aria-label={t("editor.unsavedChanges")} />
				) : null}
				{isMarkdown ? (
					<button
						type="button"
						className="ib"
						aria-label={isPreviewing ? t("editor.viewSource") : t("editor.viewPreview")}
						{...tip.handlers(isPreviewing ? t("editor.viewSource") : t("editor.viewPreview"))}
						onClick={() => {
							setMarkdownView(isPreviewing ? "source" : "preview");
						}}
					>
						{isPreviewing ? <Code size={14} strokeWidth={1.5} /> : <Eye size={14} strokeWidth={1.5} />}
					</button>
				) : null}
				{isText && !isEditing ? (
					<button
						type="button"
						className="ib"
						aria-label={t("editor.edit")}
						onClick={() => {
							// 预览里点铅笔直接落到源码的编辑态，不用先切一次模式
							setMarkdownView("source");
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
							aria-label={t("editor.save")}
							disabled={!isDirty || isSaving}
							onClick={() => void save()}
						>
							{isSaved ? (
								<Check size={14} strokeWidth={1.5} />
							) : (
								<span className="file-save">{t("editor.saved")}</span>
							)}
						</button>
						<button
							type="button"
							className="ib"
							aria-label={t("editor.exitEdit")}
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
				{headerTrailing}
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
			{isText && isPreviewing ? (
				<div className="file-preview scroll-both">
					<Markdown text={draft} isStreaming={false} indexKey={path} />
				</div>
			) : isText ? (
				<CodeSurface
					text={draft}
					path={path}
					readOnly={!isEditing}
					onChange={setDraft}
					onSaveShortcut={() => void save()}
				/>
			) : (
				<p className="chg-note">
					{content.kind === "binary" ? t("editor.binaryNoPreview") : t("editor.tooLargeNoPreview")}
				</p>
			)}
			{tip.render()}
		</div>
	);
}
