/**
 * 工作区里的「预览 + 索引」两栏。
 *
 * 文件与变更两个工具都是这个形状：左边是预览（文件内容 / 补丁），右边是索引（文件树 /
 * 变更列表）。DOM 顺序就是两栏态的视觉与阅读顺序——预览在前、索引在后，不靠 `row-reverse`
 * 反转：依赖视觉翻转的话，键盘 Tab 与读屏仍然按「索引在前」走，和眼睛看到的对不上。
 *
 * 右栏窄的时候（`< WORKSPACE_SPLIT_WIDE_WIDTH_PX`）两栏是挤不下的：预览只剩一条窄缝、
 * 索引也只有一百来像素。这时改成**单栏钻取**——一次只显示一层，点文件/改动进预览，预览
 * 顶栏左上角的面包屑退回列表。哪一层显示由 `view` 给，样式只看结果。
 *
 * 断点用容器查询而不是 JS 量宽：`panel.css` 里那条 `@container (width >= 680px)` 与这里的
 * 常量是同一个数，样式负责真的换排布，这一层不参与判定。宽栏拖动与 `⤢` 宽展开都会改变
 * 容器宽度，两栏因此自动解锁、缩回去又自动回到单栏。
 *
 * **索引栏的宽度可拖**：给了 `listWidth` 与 `onListWidthChange` 就在两栏交界处放一条分隔条
 * （与文件树那条同一个 `PaneResizer`）。拖动期间它把 `--workspace-list-width` 直接写在
 * `.app` 上，不经过渲染；松手才提交一次给宿主落盘。上限按这一层自己量到的容器宽现算——
 * `⤢` 宽展开与窄档抽屉都会改变容器宽，偏好宽只负责下限。
 */

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { LAYOUT_PX } from "../layout/layout-contract.ts";
import { PaneResizer } from "./pane-resizer.tsx";
import { WORKSPACE_LIST_MIN_WIDTH, workspaceListMaxWidth } from "./workspace-list-state.ts";

/** 单栏钻取停在哪一层。 */
export type WorkspaceSplitView = "list" | "detail";

/** 预览 + 索引两栏的参数。 */
export interface WorkspaceSplitProps {
	/** 左边那一栏：预览内容 */
	detail: ReactNode;
	/** 右边那一栏：索引，自带表头 */
	list: ReactNode;
	/** 单栏钻取时停在哪一层；两栏态忽略 */
	view: WorkspaceSplitView;
	/** 两栏态下手动收起了索引：不占位，预览占满 */
	isListCollapsed?: boolean;
	/** 组件自己的类名，用来区分文件树与变更列表 */
	className?: string;
	/** 两栏态下索引栏的宽度（px）；不给时不渲染分隔条 */
	listWidth?: number | undefined;
	/** 松手时提交索引栏宽度 */
	onListWidthChange?: ((width: number) => void) | undefined;
}

/**
 * 解锁两栏的容器宽度（CSS px）。
 *
 * 与 `panel.css` 里 `@container (width >= 680px)` 是同一个数：容器查询里不能写变量，改一处
 * 要改两处。680 是「预览还能放下一屏代码、索引还能放下一列文件名」的宽度。
 */
export const WORKSPACE_SPLIT_WIDE_WIDTH_PX = LAYOUT_PX.workspaceSplitWideWidth;

export function WorkspaceSplit({
	detail,
	list,
	view,
	isListCollapsed = false,
	className,
	listWidth,
	onListWidthChange,
}: WorkspaceSplitProps): ReactNode {
	const { t } = useI18n();
	const rootRef = useRef<HTMLDivElement | null>(null);
	/** 这一层的实际宽度：拖拽上限按它现算，不猜外面是列宽、抽屉还是 `⤢` */
	const [containerWidth, setContainerWidth] = useState(0);

	useEffect(() => {
		const node = rootRef.current;
		if (node === null) {
			return;
		}
		const read = (): void => setContainerWidth(node.clientWidth);
		read();
		const observer = new ResizeObserver(read);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	const classes = ["workspace-split", isListCollapsed ? "is-list-collapsed" : undefined, className]
		.filter((name): name is string => name !== undefined && name.length > 0)
		.join(" ");
	return (
		<div className={classes} data-view={view} ref={rootRef}>
			<div className="workspace-split-detail">{detail}</div>
			{listWidth === undefined || onListWidthChange === undefined ? null : (
				<PaneResizer
					className="workspace-list-resizer"
					label={t("panel.resizeList")}
					width={listWidth}
					min={WORKSPACE_LIST_MIN_WIDTH}
					max={workspaceListMaxWidth(containerWidth)}
					cssVar="--workspace-list-width"
					side="start"
					onWidthChange={onListWidthChange}
				/>
			)}
			{/* 索引栏自己纵向滚；`scroll-y` 保证滚动条是全仓那一套细条 */}
			<div className="workspace-split-list scroll-y">{list}</div>
		</div>
	);
}
