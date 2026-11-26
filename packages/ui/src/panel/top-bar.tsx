/**
 * 顶部两端的开关。
 *
 * 左右两枚开关各自固定锚在顶带左上角与窗口按钮簇左侧：无论对应侧栏展开、收起、
 * 拖拽调宽还是右栏宽展开，都保持坐标不变、共用同一个外框并仅对内部竖线做平滑形变，
 * 支持原地连续点击。它们各自标 `no-drag`，中间空白可拖动窗口。
 */
import type { ReactNode } from "react";
import { Badge } from "../common/Badge.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";

/**
 * 侧栏开合线框图标：`panel-left / panel-right`（展开）与 `square-padding-left /
 * square-padding-right`（收起）共用同一个圆角外框，仅内部竖线按方向通过 CSS 平移与收短。
 */
export function PanelEdgeGlyph({ side, isOpen }: { side: "left" | "right"; isOpen: boolean }): ReactNode {
	const x = side === "left" ? 9 : 15;
	return (
		<svg
			className="ui-icon panel-toggle-icon"
			width={ICON_SIZE.lg}
			height={ICON_SIZE.lg}
			viewBox="0 0 24 24"
			data-side={side}
			data-open={isOpen}
			aria-hidden="true"
		>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<line className="panel-toggle-bar" x1={x} y1="3" x2={x} y2="21" pathLength={18} />
		</svg>
	);
}

/** 左栏开关：固定锚在顶带左上角，随开合态在 `panel-left` 与 `square-padding-left` 间平滑过渡。 */
export function SidebarToggle({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
	const { t } = useI18n();
	const label = isOpen ? t("panel.collapseSidebar") : t("panel.expandSidebar");
	return (
		<IconButton
			variant="ghost"
			size="sm"
			className="chrome-toggle is-sidebar"
			aria-label={label}
			aria-expanded={isOpen}
			onClick={onToggle}
		>
			<PanelEdgeGlyph side="left" isOpen={isOpen} />
		</IconButton>
	);
}

/** 右栏开关：固定锚在窗口按钮簇左侧，随开合态在 `panel-right` 与 `square-padding-right` 间平滑过渡。 */
export function PanelToggle({
	isOpen,
	onToggle,
	badge,
}: {
	isOpen: boolean;
	onToggle: () => void;
	/** 角标：右栏收起时把未提交的改动数挂在它上面；不给、为 0 或展开时不显示 */
	badge?: number | string | undefined;
}): ReactNode {
	const { t } = useI18n();
	const label = isOpen ? t("panel.collapsePanel") : t("panel.expandPanel");
	const showsBadge = !isOpen && badge !== undefined && badge !== 0 && badge !== "";
	return (
		<IconButton
			variant="ghost"
			size="sm"
			radius="pill"
			className="chrome-toggle is-panel"
			aria-label={label}
			aria-expanded={isOpen}
			onClick={onToggle}
		>
			<PanelEdgeGlyph side="right" isOpen={isOpen} />
			{showsBadge ? (
				<Badge variant="accent" className="chrome-toggle-badge" aria-hidden="true">
					{badge}
				</Badge>
			) : null}
		</IconButton>
	);
}
