/**
 * 右侧栏。
 *
 * 顶部是「文件 / 变更」两个分页，左边一条可以拖动的分隔条，宽度拖一次记一次。内容由宿主
 * 填进来：文件页是目录树与编辑器，变更页是工作树的改动。
 */
import { PanelRightClose } from "lucide-react";
import { type ReactNode, type PointerEvent as ReactPointerEvent, useCallback, useRef } from "react";
import { clampPanelWidth, PANEL_MAX_WIDTH, PANEL_MIN_WIDTH, type RightPanelTab } from "./panel-state.ts";

export interface RightPanelProps {
	/** 当前分页 */
	tab: RightPanelTab;
	onTabChange: (tab: RightPanelTab) => void;
	/** 宽度，单位 px */
	width: number;
	/** 拖动分隔条时给出新宽度 */
	onWidthChange: (width: number) => void;
	/** 收起右栏 */
	onClose: () => void;
	/** 分页内容 */
	children: ReactNode;
}

/** 两个分页的名称。 */
const TABS: readonly { id: RightPanelTab; label: string }[] = [
	{ id: "files", label: "文件" },
	{ id: "changes", label: "变更" },
];

export function RightPanel({ tab, onTabChange, width, onWidthChange, onClose, children }: RightPanelProps) {
	const dragging = useRef<{ startX: number; startWidth: number } | undefined>(undefined);

	/** 按住分隔条开始拖：记住起点，指针捕获到分隔条上，拖出栏外也不会断。 */
	const handlePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			event.preventDefault();
			dragging.current = { startX: event.clientX, startWidth: width };
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[width],
	);

	/** 往左拖变宽，往右拖变窄，宽度收在上下限之间。 */
	const handlePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const start = dragging.current;
			if (start === undefined) {
				return;
			}
			onWidthChange(clampPanelWidth(start.startWidth - (event.clientX - start.startX)));
		},
		[onWidthChange],
	);

	const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
		dragging.current = undefined;
		event.currentTarget.releasePointerCapture(event.pointerId);
	}, []);

	return (
		<aside className="panel" style={{ width }}>
			<div
				className="panel-resizer"
				role="separator"
				aria-orientation="vertical"
				aria-label="调整右侧栏宽度"
				aria-valuenow={width}
				aria-valuemin={PANEL_MIN_WIDTH}
				aria-valuemax={PANEL_MAX_WIDTH}
				onPointerDown={handlePointerDown}
				onPointerMove={handlePointerMove}
				onPointerUp={handlePointerUp}
				onPointerCancel={handlePointerUp}
			/>
			<div className="panel-head">
				<div className="panel-tabs" role="tablist" aria-label="右侧栏分页">
					{TABS.map((item) => (
						<button
							key={item.id}
							type="button"
							role="tab"
							className={item.id === tab ? "panel-tab is-on" : "panel-tab"}
							aria-selected={item.id === tab}
							onClick={() => onTabChange(item.id)}
						>
							{item.label}
						</button>
					))}
				</div>
				<button type="button" className="ib" aria-label="收起右侧栏" title="收起右侧栏" onClick={onClose}>
					<PanelRightClose size={15} strokeWidth={1.5} />
				</button>
			</div>
			<div className="panel-body" role="tabpanel">
				{children}
			</div>
		</aside>
	);
}
