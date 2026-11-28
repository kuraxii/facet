/**
 * 文件查看与编辑。
 *
 * 文本文件**直接可编辑**：没有「先点铅笔进编辑态」那一步，`Mod-s` 或保存按钮写回磁盘，
 * 写之前带上载入时拿到的 revision。磁盘上的内容在别处被改过时主机回冲突，这里给出
 * 「重新加载」与「覆盖」两个选择，改动先留在编辑器里。
 *
 * Markdown 多一个「渲染 / 源码」的呈现切换——那是呈现方式，不是权限：切到源码就能改。
 */
import type { FileContent } from "@facet/protocol";
import { useI18n } from "@facet/ui/i18n";
import { Markdown } from "@facet/ui/markdown";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { CodeSurface } from "./code-surface.tsx";
import { FileHeaderBar } from "./file-header.tsx";
import { isMarkdownPath } from "./markdown-file.ts";

/** 写回的结果。 */
export interface FileSaveResult {
	/** 写完之后的摘要 */
	revision: string;
	/** 写完之后的修改时间，Unix 毫秒 */
	modifiedAt: number;
}

/** `useFileDocument` 的参数。 */
export interface UseFileDocumentOptions {
	/** 当前打开的文件相对路径；未打开文件时为空 */
	path?: string;
	/** 读到的内容；未打开或尚未加载完成时为空 */
	content?: FileContent;
	/** 写回磁盘；内容冲突时抛出的错误带 conflict 标记 */
	onSave?: (text: string, expectedRevision: string) => Promise<FileSaveResult>;
	/** 重新从磁盘读取 */
	onReload?: () => Promise<FileContent>;
}

/** 当前打开文件的编辑态与动作（供顶栏与正文共享）。 */
export interface FileDocumentState {
	/** 当前编辑器草稿文本 */
	draft: string;
	/** 更新草稿文本 */
	setDraft: (next: string) => void;
	/** 是否有未保存改动 */
	isDirty: boolean;
	/** 正在写盘 */
	isSaving: boolean;
	/** 刚保存成功 */
	isSaved: boolean;
	/** 写盘失败原因 */
	saveError: string | undefined;
	/** 磁盘内容与打开时不一致 */
	hasConflict: boolean;
	/** 是否文本文件 */
	isText: boolean;
	/** 是否允许 Markdown 预览/源码切换 */
	isMarkdown: boolean;
	/** 当前是否处于 Markdown 渲染预览态 */
	isPreviewing: boolean;
	/** 写回磁盘 */
	save: () => Promise<void>;
	/** 从磁盘重新加载并覆盖本地草稿 */
	reload: () => Promise<void>;
	/** 取最新 revision 并用当前草稿覆盖磁盘 */
	overwrite: () => Promise<void>;
	/** 切换 Markdown 预览/源码 */
	togglePreview: () => void;
}

export interface FileViewProps {
	/** 可选的项目名（显示在面包屑首位） */
	projectName?: string;
	/** 相对项目根的路径 */
	path: string;
	/** 读到的内容；只有文本会进编辑器 */
	content: FileContent;
	/** 代码区是否开启自动换行 */
	wordWrap?: boolean;
	/** 写回磁盘；内容冲突时抛出的错误带 conflict 标记 */
	onSave: (text: string, expectedRevision: string) => Promise<FileSaveResult>;
	/** 重新从磁盘读取 */
	onReload: () => Promise<FileContent>;
	/** 切换自动换行 */
	onToggleWordWrap?: () => void;
	/**
	 * 挂在标题行最右端的额外动作。
	 *
	 * 工作区用它放「展开文件树」：树收起之后预览占满，这个入口跟着标题行走，位置固定。
	 */
	headerTrailing?: ReactNode;
}

/** `FileEditorBody` 的参数。 */
export interface FileEditorBodyProps {
	/** 相对项目根的路径 */
	path: string;
	/** 读到的内容 */
	content: FileContent;
	/** 代码区是否开启自动换行 */
	wordWrap?: boolean;
	/** `useFileDocument` 返回的文档状态 */
	doc: FileDocumentState;
}

/** 保存失败时用来判断是不是冲突。 */
function isConflict(error: unknown): boolean {
	return (
		typeof error === "object" && error !== null && (error as { code?: unknown }).code === "file_conflict"
	);
}

/** Markdown 文件的两种呈现：渲染后的预览，与可编辑的源码。 */
type MarkdownView = "preview" | "source";

/** 管理当前打开文件的草稿、保存、冲突与 Markdown 预览切换。 */
export function useFileDocument({
	path,
	content,
	onSave,
	onReload,
}: UseFileDocumentOptions): FileDocumentState {
	const [draft, setDraft] = useState(content?.kind === "text" ? content.content : "");
	const [baseline, setBaseline] = useState(content?.kind === "text" ? content.content : "");
	const [revision, setRevision] = useState(content?.kind === "text" ? content.revision : "");
	const [isSaving, setIsSaving] = useState(false);
	const [saveError, setSaveError] = useState<string | undefined>(undefined);
	const [hasConflict, setHasConflict] = useState(false);
	const [isSaved, setIsSaved] = useState(false);
	const [markdownView, setMarkdownView] = useState<MarkdownView>("preview");

	// 切换到不同文件时重置预览态与短暂保存状态
	useEffect(() => {
		void path;
		setMarkdownView("preview");
		setIsSaved(false);
	}, [path]);

	// 换文件或重新读到内容时同步基线与草稿
	useEffect(() => {
		setDraft(content?.kind === "text" ? content.content : "");
		setBaseline(content?.kind === "text" ? content.content : "");
		setRevision(content?.kind === "text" ? content.revision : "");
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

	const isText = content?.kind === "text";
	const isDirty = isText && draft !== baseline;
	const isMarkdown = isText && path !== undefined && isMarkdownPath(path);
	const isPreviewing = isMarkdown && markdownView === "preview";

	/** 写回磁盘。冲突与其它失败分开处理，冲突时给两个选择。 */
	const save = useCallback(async (): Promise<void> => {
		if (!isText || isSaving || onSave === undefined) {
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
	}, [draft, isSaving, isText, onSave, revision]);

	/** 重新加载：丢掉编辑器里的改动，回到磁盘上的内容。 */
	const reload = useCallback(async (): Promise<void> => {
		if (onReload === undefined) {
			return;
		}
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
		if (onReload === undefined || onSave === undefined) {
			return;
		}
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

	const togglePreview = useCallback((): void => {
		setMarkdownView((current) => (current === "preview" ? "source" : "preview"));
	}, []);

	return {
		draft,
		setDraft,
		isDirty,
		isSaving,
		isSaved,
		saveError,
		hasConflict,
		isText,
		isMarkdown,
		isPreviewing,
		save,
		reload,
		overwrite,
		togglePreview,
	};
}

/** 文件正文内容区：冲突提示、保存失败提示与源码/预览切换主体。 */
export function FileEditorBody({ path, content, wordWrap = false, doc }: FileEditorBodyProps): ReactNode {
	const { t } = useI18n();
	return (
		<>
			{doc.hasConflict ? (
				<p className="chg-note is-error">
					文件已在磁盘上改动。
					<button type="button" className="chg-retry" onClick={() => void doc.reload()}>
						重新加载
					</button>
					<button type="button" className="chg-retry" onClick={() => void doc.overwrite()}>
						覆盖
					</button>
				</p>
			) : null}
			{doc.saveError === undefined ? null : <p className="chg-note is-error">{doc.saveError}</p>}
			{doc.isText && doc.isPreviewing ? (
				<div className="file-preview scroll-both">
					<Markdown text={doc.draft} isStreaming={false} indexKey={path} />
				</div>
			) : doc.isText ? (
				<CodeSurface
					text={doc.draft}
					path={path}
					readOnly={false}
					wordWrap={wordWrap}
					onChange={doc.setDraft}
					onSaveShortcut={() => void doc.save()}
				/>
			) : (
				<p className="chg-note">
					{content.kind === "binary" ? t("editor.binaryNoPreview") : t("editor.tooLargeNoPreview")}
				</p>
			)}
		</>
	);
}

/** 独立文件视图（含顶栏与正文）；工作区标签页直接复用顶栏全宽布局。 */
export function FileView({
	projectName,
	path,
	content,
	wordWrap = false,
	onSave,
	onReload,
	onToggleWordWrap,
	headerTrailing,
}: FileViewProps): ReactNode {
	const doc = useFileDocument({ path, content, onSave, onReload });
	return (
		<div className="file-view">
			<FileHeaderBar
				projectName={projectName}
				path={path}
				isDirty={doc.isDirty}
				isSaved={doc.isSaved}
				isSaving={doc.isSaving}
				isText={doc.isText}
				isMarkdown={doc.isMarkdown}
				isPreviewing={doc.isPreviewing}
				wordWrap={wordWrap}
				copyText={doc.isText ? doc.draft : undefined}
				onSave={() => void doc.save()}
				onTogglePreview={doc.togglePreview}
				onToggleWordWrap={onToggleWordWrap}
				trailing={headerTrailing}
			/>
			<FileEditorBody path={path} content={content} wordWrap={wordWrap} doc={doc} />
		</div>
	);
}
