/**
 * 一行的泳道图。
 *
 * 拿 `git-graph-layout.ts` 算好的列号与连线画出来：竖直方向是「上一行到底下一行」，节点在
 * 行中央。宽度由最大泳道数决定，行高固定，所以整张图谱是一列等高的方块，滚动时不会抖。
 */
import type { ReactNode } from "react";
import styles from "./git.module.css";
import type { GitGraphRow } from "./git-graph-layout.ts";

/** 一条泳道的横向间距（CSS px）。 */
export const LANE_GAP = 12;
/** 行高（CSS px）：与列表行高一致，SVG 才能与文字对得上。 */
export const GRAPH_ROW_HEIGHT = 26;
/** 节点半径。 */
const NODE_RADIUS = 3.2;

/** 泳道配色：按颜色索引取一个变量，循环使用。 */
const LANE_COLORS = [
	"var(--graph-lane-1)",
	"var(--graph-lane-2)",
	"var(--graph-lane-3)",
	"var(--graph-lane-4)",
	"var(--graph-lane-5)",
	"var(--graph-lane-6)",
] as const;

/** 颜色索引到实际颜色。 */
function laneColor(color: number): string {
	return LANE_COLORS[color % LANE_COLORS.length] ?? LANE_COLORS[0];
}

/** 列号到横坐标；左右各留半个间距，节点才不贴边。 */
function laneX(lane: number): number {
	return LANE_GAP / 2 + lane * LANE_GAP;
}

/** 一条泳道图层。 */
export interface GitGraphLanesProps {
	/** 这一行的布局 */
	row: GitGraphRow;
	/** 这一段历史的最大泳道数，决定宽度 */
	maxLanes: number;
}

/** 一行的泳道图。 */
export function GitGraphLanes({ row, maxLanes }: GitGraphLanesProps): ReactNode {
	const width = Math.max(maxLanes, row.lane + 1) * LANE_GAP;
	const mid = GRAPH_ROW_HEIGHT / 2;
	const nodeX = laneX(row.lane);
	return (
		<svg
			className={styles.lanes}
			width={width}
			height={GRAPH_ROW_HEIGHT}
			viewBox={`0 0 ${width} ${GRAPH_ROW_HEIGHT}`}
			aria-hidden="true"
		>
			{row.hasIncoming ? (
				<line x1={nodeX} y1={0} x2={nodeX} y2={mid} stroke={laneColor(row.color)} strokeWidth={1.5} />
			) : null}
			{row.links.map((link) => {
				const fromX = laneX(link.from);
				const toX = laneX(link.to);
				const stroke = laneColor(link.color);
				if (link.kind === "through") {
					return (
						<line
							key={`t:${link.from}`}
							x1={fromX}
							y1={0}
							x2={toX}
							y2={GRAPH_ROW_HEIGHT}
							stroke={stroke}
							strokeWidth={1.5}
						/>
					);
				}
				// 从节点出发：先竖直离开节点，再拐到目标列，最后竖直落下
				const path =
					fromX === toX
						? `M ${fromX} ${mid} L ${toX} ${GRAPH_ROW_HEIGHT}`
						: `M ${fromX} ${mid} C ${fromX} ${mid + GRAPH_ROW_HEIGHT / 4}, ${toX} ${GRAPH_ROW_HEIGHT / 2}, ${toX} ${GRAPH_ROW_HEIGHT}`;
				return (
					<path key={`o:${link.from}:${link.to}`} d={path} fill="none" stroke={stroke} strokeWidth={1.5} />
				);
			})}
			<circle cx={nodeX} cy={mid} r={NODE_RADIUS} fill={laneColor(row.color)} />
		</svg>
	);
}
