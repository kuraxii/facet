/**
 * 文件标签：编辑器与文件树。
 *
 * 两者在同一层并排——编辑器占剩下的宽度，文件树按自己的宽度占位，收起时整栏不占地方。
 * 树宽可拖（`180 / 240 / 420`，落盘 `facet.files.treeWidth`），上限按容器现算；编辑器被
 * 挤窄之后长行改为横向滚动，由 `.cm-scroller` 负责。
 *
 * 这一层持有自己的视图状态（树开关、树宽、容器宽），外壳不再替它记账。
 */
import {
	baseName,
	clampFileTreeWidth,
	FILE_TREE_MIN_WIDTH,
	FilesPane,
	fileTreeMaxWidth,
	ICON_SIZE,
	IconButton,
	isScratchCwd,
	PaneResizer,
	readFileTreeOpen,
	readFileTreeWidth,
	readFileWordWrap,
	useHoverTip,
	useI18n,
	writeFileTreeOpen,
	writeFileTreeWidth,
	writeFileWordWrap,
} from "@facet/ui";
import { FileEditorBody, FileHeaderBar, useFileDocument } from "@facet/ui-editor";
import { FolderTree } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { type WorkspaceDocs, workspaceFileKey } from "../../hooks/useWorkspaceDocs.ts";
import { useHostClient } from "../../host-context.tsx";
import type { ScopedStorage } from "../../local-storage.ts";

/** 文件标签的参数。 */
export interface FilesTabProps {
	/** 文档数据 */
	docs: WorkspaceDocs;
	/** 当前会话所在的目录；没有会话时为空 */
	sessionCwd: string | undefined;
	/** 按主机隔离的持久化存储，用于保存文件树宽度与开关 */
	storage?: ScopedStorage;
}

/** 文件标签。 */
export function FilesTab({ docs, sessionCwd, storage }: FilesTabProps): ReactNode {
	const { t } = useI18n();
	const client = useHostClient();
	const backingStorage = storage ?? window.localStorage;
	/** 文件树开着没有；关掉只藏起来，树的展开状态与滚动位置都留着 */
	const [isFileTreeOpen, setIsFileTreeOpen] = useState(() => readFileTreeOpen(backingStorage));
	/** 代码区是否开启自动换行 */
	const [wordWrap, setWordWrap] = useState(() => readFileWordWrap(backingStorage));
	/** 文件树的偏好宽，落盘里长期留着 */
	const [treeWidth, setTreeWidth] = useState(() => readFileTreeWidth(backingStorage));
	/** 文件视图的容器宽：拖拽上限按它现算 */
	const [filesWidth, setFilesWidth] = useState(0);
	const filesRef = useRef<HTMLDivElement | null>(null);

	/*
	 * 偏好宽写在根节点上。
	 *
	 * 拖动期间分隔条把同一个变量写在 `.app` 上——更近的祖先赢，所以拖动是即时的、不经过
	 * 渲染；松手提交之后这里把根节点对齐到同一个值，两者不会打架。
	 */
	useLayoutEffect(() => {
		document.documentElement.style.setProperty("--file-tree-width", `${treeWidth}px`);
	}, [treeWidth]);

	// 文件视图的容器宽：拖拽上限 = 容器 − EDITOR_KEEP_WIDTH，再收进 [180, 420]
	useEffect(() => {
		const node = filesRef.current;
		if (node === null) {
			return;
		}
		const read = (): void => setFilesWidth(node.clientWidth);
		read();
		const observer = new ResizeObserver(read);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	/** 松手时提交文件树宽度并落盘。 */
	const commitTreeWidth = useCallback(
		(next: number) => {
			const width = clampFileTreeWidth(next);
			setTreeWidth(width);
			writeFileTreeWidth(backingStorage, width);
		},
		[backingStorage],
	);

	const toggleFileTree = useCallback(() => {
		setIsFileTreeOpen((open) => {
			const next = !open;
			writeFileTreeOpen(backingStorage, next);
			return next;
		});
	}, [backingStorage]);

	const toggleWordWrap = useCallback(() => {
		setWordWrap((current) => {
			const next = !current;
			writeFileWordWrap(backingStorage, next);
			return next;
		});
	}, [backingStorage]);

	/** 正在预览的文件：没有它时预览区是空的，等用户从树里点一个 */
	const fileRef = docs.file;
	const fileContent =
		fileRef === undefined ? undefined : docs.fileContents[workspaceFileKey(fileRef.cwd, fileRef.path)];
	const activeCwd = fileRef?.cwd ?? sessionCwd;
	const projectLabel =
		activeCwd !== undefined && activeCwd.length > 0 && !isScratchCwd(activeCwd)
			? baseName(activeCwd) || activeCwd
			: undefined;

	const doc = useFileDocument({
		path: fileRef?.path,
		content: fileContent,
		onSave:
			fileRef === undefined
				? undefined
				: (text, expectedRevision) => client.writeFile(fileRef.cwd, fileRef.path, text, expectedRevision),
		onReload:
			fileRef === undefined
				? undefined
				: async () => {
						const next = await client.readFile(fileRef.cwd, fileRef.path);
						docs.setFileContent(workspaceFileKey(fileRef.cwd, fileRef.path), next);
						return next;
					},
	});
	const hasOpenFile = docs.fileError === undefined && fileRef !== undefined && fileContent !== undefined;

	/** 编辑器顶栏最右端的「文件树开关」 */
	const treeToggle = <FileTreeToggle isOpen={isFileTreeOpen} onToggle={toggleFileTree} />;

	/*
	 * 文件预览。
	 *
	 * 取文件失败时把原因摆在预览区：树那边只显示「读取失败」，具体是哪一句只有这里说得清。
	 */
	let fileDetail: ReactNode;
	if (docs.fileError !== undefined) {
		fileDetail = (
			<p className="chg-note is-error">
				{docs.fileError}
				<button type="button" className="chg-retry" onClick={docs.clearFileError}>
					{t("editor.backToDirectory")}
				</button>
			</p>
		);
	} else if (hasOpenFile) {
		fileDetail = (
			<FileEditorBody
				key={workspaceFileKey(fileRef.cwd, fileRef.path)}
				path={fileRef.path}
				content={fileContent}
				wordWrap={wordWrap}
				doc={doc}
			/>
		);
	} else {
		fileDetail = <div className="workspace-split-empty" />;
	}

	return (
		<div className="workspace-files" ref={filesRef}>
			<FileHeaderBar
				projectName={projectLabel}
				path={fileRef?.path}
				isDirty={hasOpenFile && doc.isDirty}
				isSaved={hasOpenFile && doc.isSaved}
				isSaving={hasOpenFile && doc.isSaving}
				isText={hasOpenFile && doc.isText}
				isMarkdown={hasOpenFile && doc.isMarkdown}
				isPreviewing={hasOpenFile && doc.isPreviewing}
				wordWrap={wordWrap}
				copyText={hasOpenFile && doc.isText ? doc.draft : undefined}
				onSave={hasOpenFile ? () => void doc.save() : undefined}
				onTogglePreview={hasOpenFile ? doc.togglePreview : undefined}
				onToggleWordWrap={toggleWordWrap}
				trailing={treeToggle}
			/>
			<div className="workspace-files-body">
				<div className="workspace-files-detail">{fileDetail}</div>
				<div className={isFileTreeOpen ? "file-tree" : "file-tree is-hidden"}>
					<PaneResizer
						className="file-tree-resizer"
						label={t("panel.resizeTree")}
						width={treeWidth}
						min={FILE_TREE_MIN_WIDTH}
						max={fileTreeMaxWidth(filesWidth)}
						cssVar="--file-tree-width"
						side="start"
						onWidthChange={commitTreeWidth}
					/>
					<FilesPane
						loadDirectory={(path) =>
							sessionCwd === undefined
								? Promise.reject(new Error(t("app.noSession")))
								: client.listDirectory(sessionCwd, path)
						}
						onOpenFile={(path) => {
							if (sessionCwd !== undefined) {
								void docs.openFile(sessionCwd, path);
							}
						}}
						selectedPath={
							docs.file !== undefined && docs.file.cwd === sessionCwd ? docs.file.path : undefined
						}
					/>
				</div>
			</div>
		</div>
	);
}

/**
 * 编辑器顶栏上的文件树开关（顶栏最右端）。
 *
 * 展开时提亮（`aria-pressed`），收起时压暗；文案即无障碍名称，也用作悬浮提示。
 */
function FileTreeToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }): ReactNode {
	const { t } = useI18n();
	const label = isOpen ? t("panel.collapseTree") : t("panel.showTree");
	const tip = useHoverTip();
	return (
		<>
			<IconButton
				variant="ghost"
				size="xs"
				className="ib workspace-head-action workspace-tree-toggle"
				aria-label={label}
				aria-pressed={isOpen}
				{...tip.handlers(label)}
				onClick={onToggle}
			>
				<FolderTree size={ICON_SIZE.md} />
			</IconButton>
			{tip.render()}
		</>
	);
}
