/**
 * 提交上的引用胶囊。
 *
 * 一条提交可能同时挂着 `HEAD`、几个分支、远端分支与 Tag。顺序固定成 HEAD → 本地分支 →
 * 远端分支 → Tag，超出上限的部分折成 `+N`：图谱的一行只留得下一两个胶囊。
 */
import type { GitRef, GitRefKind } from "@facet/protocol";
import type { ReactNode } from "react";
import styles from "./git.module.css";

/** 种类之间的先后顺序：越靠前越要紧。 */
const KIND_ORDER: readonly GitRefKind[] = ["head", "branch", "remote", "tag"];

/** 引用胶囊的参数。 */
export interface GitRefsProps {
	/** 挂在这条提交上的引用 */
	refs: readonly GitRef[];
	/** 最多显示几个，超出的折成 `+N`；缺省 3 */
	max?: number;
}

/** 引用胶囊；没有引用时不渲染。 */
export function GitRefs({ refs, max = 3 }: GitRefsProps): ReactNode {
	if (refs.length === 0) {
		return null;
	}
	const sorted = [...refs].sort(
		(left, right) => KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind),
	);
	const shown = sorted.slice(0, max);
	const rest = sorted.length - shown.length;
	return (
		<span className={styles.refs}>
			{shown.map((ref) => (
				<span key={`${ref.kind}:${ref.name}`} className={styles.ref} data-kind={ref.kind} title={ref.name}>
					{ref.name}
				</span>
			))}
			{rest > 0 ? <span className={styles.refMore}>+{rest}</span> : null}
		</span>
	);
}
