/**
 * 侧栏头部。
 *
 * 内容与侧栏主体分开，因为这一行落在窗口顶部那条带里，由外壳统一排布。搜索框本身留在侧栏
 * 主体里，这里只负责开合它。
 */
import { FolderPlus, Search } from "lucide-react";

export interface SidebarHeaderProps {
	/** 会话搜索框是否展开 */
	isSearchOpen: boolean;
	/** 开合搜索框 */
	onToggleSearch: () => void;
	/** 打开添加项目 */
	onAddProject: () => void;
}

export function SidebarHeader({ isSearchOpen, onToggleSearch, onAddProject }: SidebarHeaderProps) {
	return (
		<div className="sb-head">
			<span className="sb-title">Facet</span>
			<span className="sb-tools">
				<button
					type="button"
					className="sb-tool"
					aria-label="搜索会话"
					aria-pressed={isSearchOpen}
					onClick={onToggleSearch}
				>
					<Search size={15} strokeWidth={1.5} />
				</button>
				<button type="button" className="sb-tool" aria-label="添加项目" onClick={onAddProject}>
					<FolderPlus size={15} strokeWidth={1.5} />
				</button>
			</span>
		</div>
	);
}
