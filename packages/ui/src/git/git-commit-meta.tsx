/**
 * 一次提交的元信息。
 *
 * 提交详情页的索引栏顶上放这一块：作者、提交时间、父提交与完整说明。父提交只给短哈希，
 * 完整哈希在悬停提示里——图谱里点不动它们，所以不做成链接。
 */
import type { GitCommit } from "@facet/protocol";
import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useHoverTip } from "../tip.tsx";
import styles from "./git.module.css";

/** 元信息的参数。 */
export interface GitCommitMetaProps {
	/** 这条提交 */
	commit: GitCommit;
}

/** 提交元信息。 */
export function GitCommitMeta({ commit }: GitCommitMetaProps): ReactNode {
	const { t, language } = useI18n();
	const tip = useHoverTip();
	const locale = language === "zh-CN" ? "zh-CN" : "en";
	const date = Date.parse(commit.authorDate);
	const parents = commit.parents ?? [];
	return (
		<div className={styles.meta}>
			<p className={styles.metaSubject}>{commit.subject}</p>
			<dl className={styles.metaList}>
				<dt>{t("panel.commitAuthor")}</dt>
				<dd>
					{commit.authorName}
					<span className={styles.metaMuted}> {commit.authorEmail}</span>
				</dd>
				<dt>{t("panel.commitTime")}</dt>
				<dd>{Number.isNaN(date) ? commit.authorDate : new Date(date).toLocaleString(locale)}</dd>
				<dt>{t("panel.commitParents")}</dt>
				<dd className={styles.metaParents}>
					{parents.length === 0 ? <span className={styles.metaMuted}>—</span> : null}
					{parents.map((parent) => (
						<code key={parent} {...tip.handlers(parent)}>
							{parent.slice(0, 7)}
						</code>
					))}
				</dd>
			</dl>
			{commit.body.trim().length === 0 ? null : <pre className={styles.metaBody}>{commit.body}</pre>}
			{tip.render()}
		</div>
	);
}
