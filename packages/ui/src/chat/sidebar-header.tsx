/**
 * 侧栏头部。
 *
 * 内容与侧栏主体分开，因为这一行落在窗口顶部那条带里，由外壳统一排布。搜索框本身留在侧栏
 * 主体里，这里只负责开合它。
 */
import { FolderPlus, Search } from "lucide-react";
import { IconButton } from "../common/IconButton.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { PanelEdgeGlyph } from "../panel/top-bar.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";

export interface SidebarHeaderProps {
	/** 会话搜索框是否展开 */
	isSearchOpen: boolean;
	/** 开合搜索框 */
	onToggleSearch: () => void;
	/** 打开添加项目（可选，留空时不显示入口） */
	onAddProject?: (() => void) | undefined;
	/** 是否渲染「Facet」字样与左栏关闭按钮（桌面宽/中屏由顶带 `.chrome-brand` 常驻，仅窄屏抽屉自己画） */
	onCollapse?: (() => void) | undefined;
}

export function SidebarHeader({
	isSearchOpen,
	onToggleSearch,
	onAddProject,
	onCollapse,
}: SidebarHeaderProps) {
	const { t } = useI18n();
	return (
		<div className="sb-head">
			{onCollapse === undefined ? null : (
				<span className="sb-head-lead">
					<span className="sb-title">Facet</span>
					<IconButton
						variant="ghost"
						size="sm"
						className="chrome-toggle"
						aria-label={t("sidebar.collapse")}
						aria-expanded={true}
						onClick={onCollapse}
					>
						<PanelEdgeGlyph side="left" isOpen={true} />
					</IconButton>
				</span>
			)}
			<span className="sb-tools">
				<IconButton
					variant="ghost"
					size="sm"
					className="chrome-toggle"
					aria-label={t("sidebar.searchSessions")}
					aria-expanded={isSearchOpen}
					onClick={onToggleSearch}
				>
					<Search size={ICON_SIZE.lg} />
				</IconButton>
				{onAddProject === undefined ? null : (
					<IconButton
						variant="ghost"
						size="sm"
						className="chrome-toggle"
						aria-label={t("common.addProject")}
						onClick={onAddProject}
					>
						<FolderPlus size={ICON_SIZE.lg} />
					</IconButton>
				)}
			</span>
		</div>
	);
}
