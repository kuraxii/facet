/**
 * 补丁正文。
 *
 * 变更页、提交详情与单文件补丁视图共用这一份：行号加一截内容，纵向按行铺开，横向默认不
 * 折行（走全仓的 `.scroll-x`，长代码行自己滚）。三处各写一遍的话，行号宽度与增删行配色
 * 迟早会分岔。
 */
import type { GitDiff } from "@facet/protocol";
import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { lineClass, patchBodyLines } from "../transcript/diff-lines.ts";
import styles from "./git.module.css";

/** 补丁正文的参数。 */
export interface GitPatchProps {
	/** 主机算好的补丁 */
	diff: GitDiff;
	/** 长行是否折行；缺省按不折行处理 */
	wrapLines?: boolean;
}

/** 补丁正文；二进制、没有改动与过长三种情况由这里给出说明。 */
export function GitPatch({ diff, wrapLines = false }: GitPatchProps): ReactNode {
	const { t } = useI18n();
	if (diff.binary) {
		return <p className={styles.note}>{t("panel.binaryDiff")}</p>;
	}
	const lines = patchBodyLines(diff.patch);
	if (lines.length === 0) {
		return <p className={styles.note}>{t("panel.noDiff")}</p>;
	}
	return (
		<>
			{diff.truncated ? <p className={styles.note}>{t("panel.truncatedDiff")}</p> : null}
			<div className={`scroll-x ${styles.diffBody}`} data-wrap={wrapLines}>
				{lines.map(({ key, line, number }) => (
					<div key={key} className={`${styles.diffLine} ${lineClass(line)}`}>
						<i>{number}</i>
						<span>{line}</span>
					</div>
				))}
			</div>
		</>
	);
}
