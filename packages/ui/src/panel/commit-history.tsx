/**
 * 提交历史。
 *
 * 变更视图底部的一段可折叠列表：从新到旧显示当前分支的提交，行内是图形上的点、短哈希、
 * 说明与相对时间；指针停在行上时给出这条提交的悬浮卡，见 `CommitTip`。
 */

import type { GitCommit, GitCommits } from "@facet/protocol";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useState } from "react";
import { shortTime } from "../chat/sidebar-model.ts";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useHoverTip } from "../tip.tsx";
import styles from "./changes.module.css";
import { CommitTip } from "./commit-tip.tsx";

export interface CommitHistoryProps {
	/** 提交清单；还没取到时为空 */
	commits: GitCommits | undefined;
	/** 正在取清单 */
	isLoading: boolean;
	/** 取清单失败的原因 */
	error: string | undefined;
	/** 点一条提交时打开它的改动 */
	onCommitPress?: (commit: GitCommit) => void;
}

/** 最近提交列表。 */
export function CommitHistory({ commits, isLoading, error, onCommitPress }: CommitHistoryProps): ReactNode {
	const { t, language } = useI18n();
	// 行里只放得下短哈希与说明第一行，其余信息由悬浮卡补上
	const tip = useHoverTip();
	const [isOpen, setIsOpen] = useState(false);

	if (commits !== undefined && !commits.isRepo) {
		return null;
	}
	if (commits === undefined && error === undefined && !isLoading) {
		return null;
	}

	const rows = commits?.commits ?? [];
	const count = commits === undefined ? undefined : rows.length;
	const locale = language === "zh-CN" ? "zh-CN" : "en";
	const now = Date.now();

	return (
		<section className={styles.commitSection} data-open={isOpen}>
			<button
				type="button"
				className={styles.commitHeader}
				aria-expanded={isOpen}
				onClick={() => setIsOpen((current) => !current)}
			>
				<ChevronRight className={styles.chevron} size={14} strokeWidth={1.5} data-open={isOpen} />
				<span className={styles.commitTitle}>{t("panel.commits")}</span>
				{count === undefined ? null : <span className={styles.commitCount}>{count}</span>}
			</button>
			{isOpen ? (
				<div className={styles.commitList}>
					{error === undefined ? null : <p className={`${styles.note} ${styles.noteError}`}>{error}</p>}
					{isLoading && commits === undefined ? (
						<>
							<div className={styles.commitSkeleton} role="status" aria-label={t("panel.loadingCommits")} />
							<div className={styles.commitSkeleton} aria-hidden />
							<div className={styles.commitSkeleton} aria-hidden />
						</>
					) : null}
					{commits === undefined ? null : rows.length === 0 ? (
						<p className={styles.note}>{t("panel.noCommits")}</p>
					) : (
						rows.map((commit, index) => (
							<button
								type="button"
								className={styles.commitRow}
								key={commit.sha}
								{...tip.handlers(<CommitTip commit={commit} webUrl={commits.webUrl} />)}
								onClick={() => onCommitPress?.(commit)}
							>
								<span
									className={styles.commitGraph}
									data-first={index === 0}
									data-last={index === rows.length - 1}
								>
									<i className={styles.commitDot} />
								</span>
								<span className={styles.commitSha}>{commit.shortSha}</span>
								<span className={styles.commitSubject}>{commit.subject}</span>
								<time className={styles.commitTime} dateTime={commit.authorDate}>
									{shortTime(new Date(commit.authorDate).getTime(), now, undefined, locale)}
								</time>
							</button>
						))
					)}
				</div>
			) : null}
			{tip.render()}
		</section>
	);
}
