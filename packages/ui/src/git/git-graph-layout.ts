/**
 * 提交图谱的泳道计算。
 *
 * 输入是按时间从新到旧排好的提交（至少要有 `sha` 与 `parents`），输出每一行的节点列号、
 * 颜色与要画的连线。纯函数：不碰 DOM、不读时间，同一份输入永远得到同一份输出，界面只负责
 * 按坐标画。
 *
 * 算法是「每条泳道在等哪个提交」：
 *
 * 1. 从上往下扫。走到一条提交时，先看它是不是某条泳道正在等的那个（`waiting[lane]`）；
 *    不是就新开一条泳道（取最左边的空位，没有空位就往后加）。
 * 2. 这条提交的第一个父提交接管它的泳道，颜色不变——一条主线因此是一根竖线。
 * 3. 其余父提交（合并提交的第二个父亲起）各自占一条泳道；已经在等的就引过去，没在等的
 *    新开一条，并给一个新颜色。这两类都画成「从节点拐到目标列」的曲线。
 * 4. 其余泳道原样穿过这一行（直连线）。
 *
 * 分页截断时父提交可能不在这一页里：泳道会继续「等着」它，扫到页尾就停在那里——图谱因此
 * 在底部留几条悬空的线，而不是报错或把列号算乱。
 */

/** 一条要画的连线。 */
export interface GitGraphLink {
	/** 上一行那一端所在的列 */
	from: number;
	/** 下一行那一端所在的列 */
	to: number;
	/** 颜色索引；同一条主线始终同色 */
	color: number;
	/**
	 * 连线形状。
	 *
	 * `through` 是不经过节点的直连线（别的泳道从这一行穿过去）；`out` 是从本行节点出发、
	 * 落到下方某一列的连线（父提交）。
	 */
	kind: "through" | "out";
}

/** 一行提交在图谱里的样子。 */
export interface GitGraphRow {
	/** 这一行对应的提交哈希 */
	sha: string;
	/** 节点所在的列，从 0 开始 */
	lane: number;
	/** 节点颜色索引 */
	color: number;
	/** 上方有没有线接着它：新建出来的一条线没有「上一行」 */
	hasIncoming: boolean;
	/** 这一行上方活跃的泳道数 */
	lanesBefore: number;
	/** 这一行下方活跃的泳道数 */
	lanesAfter: number;
	/** 这一行要画的连线 */
	links: readonly GitGraphLink[];
}

/** 一次布局的结果。 */
export interface GitGraphLayout {
	/** 与输入一一对应的行 */
	rows: readonly GitGraphRow[];
	/** 整段历史里同时活跃过的最大泳道数；给 SVG 定宽用 */
	maxLanes: number;
}

/** 布局能看到的提交：只关心哈希与父提交。 */
export interface GitGraphCommit {
	/** 完整提交哈希 */
	sha: string;
	/** 父提交哈希，按提交里记录的顺序；缺省按没有父提交处理 */
	parents?: readonly string[];
}

/** 泳道数上限：再宽也没人看得清，超出的一律并到最后一列，避免一个怪仓库把宽度顶爆。 */
const MAX_LANES = 16;

/** 去掉尾部空泳道，返回实际长度。 */
function trimmedLength(lanes: readonly (string | undefined)[]): number {
	let end = lanes.length;
	while (end > 0 && lanes[end - 1] === undefined) {
		end -= 1;
	}
	return end;
}

/** 最左边的空泳道；都占着就往后加一条。 */
function allocate(lanes: (string | undefined)[], colors: number[], color: number): number {
	for (let index = 0; index < lanes.length; index += 1) {
		if (lanes[index] === undefined) {
			colors[index] = color;
			return index;
		}
	}
	lanes.push(undefined);
	colors.push(color);
	return lanes.length - 1;
}

/**
 * 算出一段历史的泳道布局。
 *
 * 列数超过 `MAX_LANES` 时新的泳道都落在最后一列并共用那里的颜色：宁可叠在一起，也不让
 * 图谱横向长到看不见提交说明。
 */
export function layoutGitGraph(commits: readonly GitGraphCommit[]): GitGraphLayout {
	/** 每条泳道正在等哪个提交 */
	const waiting: (string | undefined)[] = [];
	/** 每条泳道的颜色索引 */
	const colors: number[] = [];
	/** 用过的颜色数，新泳道取下一个，尽量不撞色 */
	let nextColor = 0;
	const rows: GitGraphRow[] = [];
	let maxLanes = 0;

	for (const commit of commits) {
		const parents = commit.parents ?? [];
		// 1. 这条提交占哪条泳道：正在等它的那条，或者新开一条
		let lane = waiting.indexOf(commit.sha);
		const hasIncoming = lane >= 0;
		if (lane < 0) {
			lane = Math.min(allocate(waiting, colors, nextColor), MAX_LANES - 1);
			nextColor += 1;
			waiting[lane] = commit.sha;
			colors[lane] = colors[lane] ?? 0;
		}
		const before = Math.min(trimmedLength(waiting), MAX_LANES);
		const color = colors[lane] ?? 0;
		const links: GitGraphLink[] = [];

		// 2. 别的泳道直穿这一行
		for (let index = 0; index < before; index += 1) {
			if (index === lane || waiting[index] === undefined) {
				continue;
			}
			links.push({ from: index, to: index, color: colors[index] ?? 0, kind: "through" });
		}

		// 3. 父提交：第一个接管本泳道，其余各占一条
		const [first, ...rest] = parents;
		waiting[lane] = undefined;
		if (first !== undefined) {
			const existing = waiting.indexOf(first);
			if (existing >= 0 && existing !== lane) {
				// 第一个父亲已经在别的泳道里等着（少见的多路合并）：并过去，本泳道让出来
				links.push({ from: lane, to: existing, color: colors[existing] ?? color, kind: "out" });
			} else {
				waiting[lane] = first;
				links.push({ from: lane, to: lane, color, kind: "out" });
			}
		}
		for (const parent of rest) {
			const existing = waiting.indexOf(parent);
			if (existing >= 0) {
				links.push({ from: lane, to: existing, color: colors[existing] ?? color, kind: "out" });
				continue;
			}
			const target = Math.min(allocate(waiting, colors, nextColor), MAX_LANES - 1);
			nextColor += 1;
			waiting[target] = parent;
			links.push({ from: lane, to: target, color: colors[target] ?? color, kind: "out" });
		}

		const after = Math.min(trimmedLength(waiting), MAX_LANES);
		maxLanes = Math.max(maxLanes, before, after, lane + 1);
		rows.push({ sha: commit.sha, lane, color, hasIncoming, lanesBefore: before, lanesAfter: after, links });

		// 收尾：把尾部空出来的泳道剪掉，下一行从紧凑的列号开始
		const end = trimmedLength(waiting);
		waiting.length = end;
		colors.length = end;
	}

	return { rows, maxLanes };
}
