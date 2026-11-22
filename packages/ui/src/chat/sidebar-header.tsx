/**
 * 侧栏头部。
 *
 * 内容与侧栏主体分开，因为这一行落在窗口顶部那条带里，由外壳统一排布。搜索框本身留在侧栏
 * 主体里，这里只负责开合它。
 */
import { FolderPlus, PanelLeft, Search } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";

export interface SidebarHeaderProps {
	/** 会话搜索框是否展开 */
	isSearchOpen: boolean;
	/** 开合搜索框 */
	onToggleSearch: () => void;
	/** 打开添加项目 */
	onAddProject: () => void;
	/** 收起侧栏；不传时不显示这个按钮 */
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
			<span className="sb-title">Facet</span>
			<span className="sb-tools">
				<button
					type="button"
					className="chrome-toggle"
					aria-label={t("sidebar.searchSessions")}
					aria-expanded={isSearchOpen}
					onClick={onToggleSearch}
				>
					<Search size={ICON_SIZE.lg} />
				</button>
				<button
					type="button"
					className="chrome-toggle"
					aria-label={t("common.addProject")}
					onClick={onAddProject}
				>
					<FolderPlus size={ICON_SIZE.lg} />
				</button>
				{onCollapse === undefined ? null : (
					<button
						type="button"
						className="chrome-toggle"
						aria-label={t("sidebar.collapse")}
						aria-expanded={true}
						onClick={onCollapse}
					>
						<PanelLeft size={ICON_SIZE.lg} />
					</button>
				)}
			</span>
		</div>
	);
}
