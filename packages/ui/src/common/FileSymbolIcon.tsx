/**
 * 基于 `miguelsolorio/vscode-symbols`（`@react-symbols/icons`）的文件与目录图标组件。
 */
import { TypeScript } from "@react-symbols/icons/files";
import {
	DefaultFolderIcon,
	DefaultFolderOpenedIcon,
	type ExtensionType,
	getIconForFile,
	getIconForFolder,
} from "@react-symbols/icons/utils";
import type { ReactNode } from "react";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { normalizeFolderSymbolName, symbolEntryBasename } from "./file-symbol-name.ts";

/** `@react-symbols/icons` 默认扩展表尚未收录的 TS 模块变体后缀。 */
const EXTRA_FILE_EXTENSIONS: ExtensionType = {
	mts: TypeScript,
	cts: TypeScript,
};

export interface FileSymbolIconProps {
	/** 文件名或相对路径 */
	name: string;
	/** 图标边长（px） */
	size?: number | undefined;
	/** 附加样式类名 */
	className?: string | undefined;
}

export interface FolderSymbolIconProps {
	/** 目录名或相对路径 */
	name: string;
	/** 目录当前是否展开 */
	isOpen?: boolean | undefined;
	/** 图标边长（px） */
	size?: number | undefined;
	/** 附加样式类名 */
	className?: string | undefined;
}

/** 渲染匹配文件名或扩展名的 Symbols 文件图标。 */
export function FileSymbolIcon({ name, size = ICON_SIZE.lg, className }: FileSymbolIconProps): ReactNode {
	return getIconForFile({
		fileName: symbolEntryBasename(name),
		autoAssign: true,
		editFileExtensionData: EXTRA_FILE_EXTENSIONS,
		width: size,
		height: size,
		className,
		"aria-hidden": true,
	});
}

/** 渲染匹配语义目录名的 Symbols 目录图标；未命中语义表时按展开态切换开合默认文件夹。 */
export function FolderSymbolIcon({
	name,
	isOpen = false,
	size = ICON_SIZE.lg,
	className,
}: FolderSymbolIconProps): ReactNode {
	const icon = getIconForFolder({
		folderName: normalizeFolderSymbolName(name),
		width: size,
		height: size,
		className,
		"aria-hidden": true,
	});
	if (isOpen && icon.type === DefaultFolderIcon) {
		return <DefaultFolderOpenedIcon width={size} height={size} className={className} aria-hidden="true" />;
	}
	return icon;
}
