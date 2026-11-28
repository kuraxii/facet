/**
 * 文件页顶栏：左放项目名与相对路径面包屑，右放预览/源码切换、保存、自动换行、
 * 复制文件内容与外部传入的收尾控件（如文件树开关）。
 */
import { useI18n } from "@facet/ui/i18n";
import { IconButton } from "@facet/ui/primitives";
import { useHoverTip } from "@facet/ui/tip";
import { ICON_SIZE } from "@facet/ui/visual-contract";
import { Check, ChevronRight, Code, Copy, Eye, Save, WrapText } from "lucide-react";
import { Fragment, type ReactNode, useEffect, useState } from "react";
import { buildFileBreadcrumbs } from "./file-breadcrumbs.ts";

export interface FileHeaderBarProps {
	/** 项目名（面包屑第一段；无项目时不传） */
	projectName?: string;
	/** 相对项目根的路径（为空表示未打开具体文件） */
	path?: string;
	/** 是否有未保存改动 */
	isDirty?: boolean;
	/** 是否刚刚保存成功 */
	isSaved?: boolean;
	/** 是否正在保存 */
	isSaving?: boolean;
	/** 是否为文本文件（决定保存与复制内容是否可用） */
	isText?: boolean;
	/** 是否允许切换 Markdown 预览/源码 */
	isMarkdown?: boolean;
	/** 当前是否处于 Markdown 渲染预览态 */
	isPreviewing?: boolean;
	/** 当前是否开启自动换行 */
	wordWrap?: boolean;
	/** 可用于复制的文件内容 */
	copyText?: string;
	/** 保存回调 */
	onSave?: () => void;
	/** 切换 Markdown 预览/源码 */
	onTogglePreview?: () => void;
	/** 切换自动换行 */
	onToggleWordWrap?: () => void;
	/** 右侧收尾按钮（工作区文件树开关等） */
	trailing?: ReactNode;
}

export function FileHeaderBar({
	projectName,
	path,
	isDirty = false,
	isSaved = false,
	isSaving = false,
	isText = false,
	isMarkdown = false,
	isPreviewing = false,
	wordWrap = false,
	copyText,
	onSave,
	onTogglePreview,
	onToggleWordWrap,
	trailing,
}: FileHeaderBarProps): ReactNode {
	const { t } = useI18n();
	const tip = useHoverTip();
	const [isCopied, setIsCopied] = useState(false);

	useEffect(() => {
		if (!isCopied) {
			return;
		}
		const timer = setTimeout(() => setIsCopied(false), 1200);
		return () => clearTimeout(timer);
	}, [isCopied]);

	const crumbs = buildFileBreadcrumbs(projectName, path);
	const fullTitle = path ?? projectName ?? "";

	const handleCopy = (): void => {
		if (!isText || copyText === undefined) {
			return;
		}
		void navigator.clipboard
			.writeText(copyText)
			.then(() => setIsCopied(true))
			.catch(() => undefined);
	};

	return (
		<div className="file-head">
			<div className="file-head-leading">
				<div className="file-breadcrumbs" {...(fullTitle.length > 0 ? tip.handlers(fullTitle) : {})}>
					{crumbs.map((segment, index) => {
						const isLast = index === crumbs.length - 1;
						const crumbKey = crumbs.slice(0, index + 1).join("/");
						return (
							<Fragment key={crumbKey}>
								{index > 0 ? (
									<ChevronRight className="file-crumb-sep" size={ICON_SIZE.sm} aria-hidden="true" />
								) : null}
								<span className={isLast ? "file-crumb is-last" : "file-crumb"}>{segment}</span>
							</Fragment>
						);
					})}
				</div>
				{isDirty ? (
					<span className="file-dirty" role="status" aria-label={t("editor.unsavedChanges")} />
				) : null}
			</div>

			<div className="file-head-actions">
				{isMarkdown && onTogglePreview !== undefined ? (
					<IconButton
						variant="ghost"
						size="xs"
						className="ib"
						aria-label={isPreviewing ? t("editor.viewSource") : t("editor.viewPreview")}
						{...tip.handlers(isPreviewing ? t("editor.viewSource") : t("editor.viewPreview"))}
						onClick={onTogglePreview}
					>
						{isPreviewing ? <Code size={ICON_SIZE.md} /> : <Eye size={ICON_SIZE.md} />}
					</IconButton>
				) : null}

				{isText && onSave !== undefined ? (
					<IconButton
						variant="ghost"
						size="xs"
						className="ib"
						aria-label={t("editor.saveShortcut")}
						disabled={!isDirty || isSaving}
						{...tip.handlers(t("editor.saveShortcut"))}
						onClick={onSave}
					>
						{isSaved ? <Check size={ICON_SIZE.md} /> : <Save size={ICON_SIZE.md} />}
					</IconButton>
				) : null}

				{onToggleWordWrap !== undefined && isText && !isPreviewing ? (
					<IconButton
						variant="ghost"
						size="xs"
						className="ib"
						aria-label={wordWrap ? t("editor.wrapOff") : t("editor.wrapOn")}
						aria-pressed={wordWrap}
						{...tip.handlers(wordWrap ? t("editor.wrapOff") : t("editor.wrapOn"))}
						onClick={onToggleWordWrap}
					>
						<WrapText size={ICON_SIZE.md} />
					</IconButton>
				) : null}

				{isText && copyText !== undefined ? (
					<IconButton
						variant="ghost"
						size="xs"
						className="ib"
						aria-label={isCopied ? t("editor.copiedContent") : t("editor.copyContent")}
						{...tip.handlers(isCopied ? t("editor.copiedContent") : t("editor.copyContent"))}
						onClick={handleCopy}
					>
						{isCopied ? <Check size={ICON_SIZE.md} /> : <Copy size={ICON_SIZE.md} />}
					</IconButton>
				) : null}

				{trailing}
			</div>

			{tip.render()}
		</div>
	);
}
