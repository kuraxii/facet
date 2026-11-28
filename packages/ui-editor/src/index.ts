/**
 * 编辑器。
 *
 * 代码面用 CodeMirror 6：只读与可编辑两态，语言按文件名加载，配色跟随界面的 CSS 变量。
 */
export type { CodeSurfaceProps } from "./code-surface.tsx";
export { CodeSurface } from "./code-surface.tsx";
export type { EditorPalette } from "./editor-theme.ts";
export { editorTheme, readEditorPalette } from "./editor-theme.ts";
export { buildFileBreadcrumbs } from "./file-breadcrumbs.ts";
export type { FileHeaderBarProps } from "./file-header.tsx";
export { FileHeaderBar } from "./file-header.tsx";
export type {
	FileDocumentState,
	FileEditorBodyProps,
	FileSaveResult,
	FileViewProps,
	UseFileDocumentOptions,
} from "./file-view.tsx";
export { FileEditorBody, FileView, useFileDocument } from "./file-view.tsx";
