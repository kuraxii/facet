/**
 * 提交悬浮卡。
 *
 * 指针停在提交图谱的一行上时给出这条提交的完整信息，分三段：作者与时间加说明、改动规模、
 * 短哈希与远端链接，段与段之间一条发丝线。列表行只放得下泳道、说明第一行与短哈希，这里
 * 补上其余部分。
 */

import type { GitCommit } from "@facet/protocol";
import { Clock, Copy, ExternalLink, GitCommitVertical } from "lucide-react";
import type { ReactNode } from "react";
import { shortTime } from "../chat/sidebar-model.ts";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import styles from "./git.module.css";

export interface CommitTipProps {
	/** 悬浮到的那条提交 */
	commit: GitCommit;
	/** 远端仓库在浏览器里的地址；没有远端时为空，不给链接 */
	webUrl: string | undefined;
}

/** 绝对时间用的格式化器，按语言缓存：每个提示都要新建一个太贵。 */
const absoluteFormatters = new Map<string, Intl.DateTimeFormat>();

/** 本地时区的绝对时间，例如 `2026年11月19日 00:35`。 */
function absoluteTime(date: Date, locale: string): string {
	let formatter = absoluteFormatters.get(locale);
	if (formatter === undefined) {
		formatter = new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" });
		absoluteFormatters.set(locale, formatter);
	}
	return formatter.format(date);
}

/** 相对时间用的格式化器，按语言缓存。 */
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();

/** 一分钟的毫秒数，比它更近的时间用侧栏那套「刚刚」。 */
const MINUTE_MS = 60_000;

/**
 * 距现在的相对时间。
 *
 * 卡片比列表行需要更粗的粒度：行里给的是「周一」这种星期，卡片里写「4 天前」才对得上
 * 后面的绝对日期。一分钟以内仍用侧栏那套措辞，界面里两处对得上。
 */
function relativeTime(value: number, locale: "zh-CN" | "en", now: number): string {
	const diff = value - now;
	if (Math.abs(diff) < MINUTE_MS) {
		return shortTime(value, now, undefined, locale);
	}
	let formatter = relativeFormatters.get(locale);
	if (formatter === undefined) {
		formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
		relativeFormatters.set(locale, formatter);
	}
	const units: readonly [Intl.RelativeTimeFormatUnit, number][] = [
		["year", 31_536_000_000],
		["month", 2_592_000_000],
		["day", 86_400_000],
		["hour", 3_600_000],
		["minute", MINUTE_MS],
	];
	for (const [unit, size] of units) {
		// 向下取整：23.6 小时说「23 小时前」，不够一整天就不说成「24 小时前」
		if (Math.abs(diff) >= size) {
			return formatter.format(Math.trunc(diff / size), unit);
		}
	}
	return shortTime(value, now, undefined, locale);
}

/** 远端地址的主机名；认不出来时为空。 */
function hostOf(url: string): string | undefined {
	try {
		return new URL(url).host;
	} catch {
		return undefined;
	}
}

/** 链接文字里的主机名：GitHub 用自己的写法，其余照原样。 */
function hostLabel(host: string): string {
	return host === "github.com" ? "GitHub" : host;
}

/**
 * 改动规模的一句话。
 *
 * 文件数、新增行数与删除行数各是一段，段与段之间用当前语言的逗号接起来；增删为 0 的那段
 * 整段不出现，合并提交没有统计时整句为空。
 */
function Stats({
	files,
	insertions,
	deletions,
}: {
	files: number;
	insertions: number;
	deletions: number;
}): ReactNode {
	const { t } = useI18n();
	const parts: { key: string; node: ReactNode }[] = [
		{
			key: "files",
			node: <span key="files">{t("panel.commitFiles", { count: files })}</span>,
		},
	];
	if (insertions > 0) {
		parts.push({
			key: "insertions",
			node: (
				<span className={styles.commitTipAdded} key="insertions">
					{t("panel.commitInsertions", { count: insertions })}
				</span>
			),
		});
	}
	if (deletions > 0) {
		parts.push({
			key: "deletions",
			node: (
				<span className={styles.commitTipRemoved} key="deletions">
					{t("panel.commitDeletions", { count: deletions })}
				</span>
			),
		});
	}
	const nodes: ReactNode[] = [];
	for (const part of parts) {
		if (nodes.length > 0) {
			nodes.push(
				<span className={styles.commitTipStatSep} key={`sep-${part.key}`}>
					{t("panel.commitStatsSeparator")}
				</span>,
			);
		}
		nodes.push(part.node);
	}
	return <p className={styles.commitTipStats}>{nodes}</p>;
}

/** 一条提交的悬浮卡。 */
export function CommitTip({ commit, webUrl }: CommitTipProps): ReactNode {
	const { t, language } = useI18n();
	const locale = language === "zh-CN" ? "zh-CN" : "en";
	const date = new Date(commit.authorDate);
	const relative = relativeTime(date.getTime(), locale, Date.now());
	const stats = commit.stats;

	// 提交页的路径各平台一致（GitHub / GitLab / Gitea 都是 `<仓库>/commit/<sha>`）；
	// 主机名认不出来时整条链接都不给
	const host = webUrl === undefined ? undefined : hostOf(webUrl);
	const href = host === undefined ? undefined : `${webUrl}/commit/${commit.sha}`;
	// 复制只做动作，不给回执：按钮与哈希的形状、颜色都不随点击改变
	const copyHash = () => {
		void navigator.clipboard?.writeText(commit.sha);
	};

	return (
		<div className={styles.commitTip}>
			<div className={styles.commitTipMain}>
				<p className={styles.commitTipHead}>
					<span className={styles.commitTipAuthor}>{commit.authorName}</span>
					<Clock className={styles.commitTipIcon} size={ICON_SIZE.md} />
					<time dateTime={commit.authorDate}>
						{relative} ({absoluteTime(date, locale)})
					</time>
				</p>
				<p className={styles.commitTipSubject}>{commit.subject}</p>
				{commit.body.length === 0 ? null : <p className={styles.commitTipBody}>{commit.body}</p>}
			</div>
			{stats === undefined ? null : (
				<div className={styles.commitTipBand}>
					<Stats files={stats.filesChanged} insertions={stats.insertions} deletions={stats.deletions} />
				</div>
			)}
			<div className={styles.commitTipBand}>
				<GitCommitVertical className={styles.commitTipAccent} size={ICON_SIZE.md} />
				<button
					type="button"
					className={styles.commitTipHash}
					aria-label={t("panel.commitCopyHash")}
					onClick={copyHash}
				>
					<span className={styles.commitTipSha}>{commit.shortSha}</span>
					<Copy size={ICON_SIZE.md} />
				</button>
				{href === undefined || host === undefined ? null : (
					<>
						<span className={styles.commitTipDivider} aria-hidden>
							|
						</span>
						<a className={styles.commitTipLink} href={href} target="_blank" rel="noreferrer">
							<ExternalLink size={ICON_SIZE.md} />
							<span>{t("panel.commitOpenRemote", { host: hostLabel(host) })}</span>
						</a>
					</>
				)}
			</div>
		</div>
	);
}
