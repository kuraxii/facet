/**
 * 编辑器。
 *
 * 代码面用 CodeMirror 6：只读与可编辑两态，语言按文件名加载，配色跟随界面的 CSS 变量。
 */
export type { CodeSurfaceProps } from "./code-surface.tsx";
export { CodeSurface } from "./code-surface.tsx";
export type { EditorPalette } from "./editor-theme.ts";
export { editorTheme, readEditorPalette } from "./editor-theme.ts";
export type { FileSaveResult, FileViewProps } from "./file-view.tsx";
export { FileView } from "./file-view.tsx";
