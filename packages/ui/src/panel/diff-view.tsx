import type { GitDiff } from "@facet/protocol";
import { RefreshCw, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useHoverTip } from "../tip.tsx";
import { lineClass, patchLines } from "../transcript/diff-lines.ts";

export interface DiffViewProps {
	/** 相对项目根的路径 */
	path: string;
	/** 未跟踪文件需要单独取补丁 */
	untracked: boolean;
	/** 取补丁 */
	loadDiff: () => Promise<GitDiff>;
	/** 关闭这个标签 */
	onClose: () => void;
}

/** 补丁的加载状态。 */
type DiffState = { kind: "loading" } | { kind: "ready"; diff: GitDiff } | { kind: "failed"; error: string };

/** 主区域里的只读补丁视图。 */
export function DiffView({ path, untracked, loadDiff, onClose }: DiffViewProps): ReactNode {
	const { t } = useI18n();
	// 文件头的完整路径走这份提示
	const tip = useHoverTip();
	const [state, setState] = useState<DiffState>({ kind: "loading" });
	const loadRef = useRef(loadDiff);
	loadRef.current = loadDiff;

	const reload = useCallback((): void => {
		setState({ kind: "loading" });
		void loadRef.current().then(
			(diff) => setState({ kind: "ready", diff }),
			(error: unknown) =>
				setState({
					kind: "failed",
					error: error instanceof Error ? error.message : String(error),
				}),
		);
	}, []);

	// 标签的路径决定内容；loadDiff 只用来取数据，不参与重载判断，避免每次渲染都重新请求。
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在换路径时重新取补丁
	useEffect(() => {
		reload();
	}, [path, untracked]);

	const header = (
		<div className="file-head">
			<span className="file-path" {...tip.handlers(path)}>
				{path}
			</span>
			<button type="button" className="ib" aria-label={t("panel.refreshChanges")} onClick={reload}>
				<RefreshCw size={13} strokeWidth={1.5} />
			</button>
			<button type="button" className="ib" aria-label={t("common.close")} onClick={onClose}>
				<X size={13} strokeWidth={1.5} />
			</button>
			{tip.render()}
		</div>
	);

	if (state.kind === "loading") {
		return (
			<div className="file-view">
				{header}
				<p className="chg-note">{t("panel.loadingDiff")}</p>
			</div>
		);
	}

	if (state.kind === "failed") {
		return (
			<div className="file-view">
				{header}
				<p className="chg-note is-error">
					{state.error}
					<button type="button" className="chg-retry" onClick={reload}>
						{t("common.retry")}
					</button>
				</p>
			</div>
		);
	}

	const { diff } = state;
	if (diff.binary) {
		return (
			<div className="file-view">
				{header}
				<p className="chg-note">{t("panel.binaryDiff")}</p>
			</div>
		);
	}
	if (diff.patch.trim().length === 0) {
		return (
			<div className="file-view">
				{header}
				<p className="chg-note">{t("panel.noDiff")}</p>
			</div>
		);
	}

	return (
		<div className="file-view">
			{header}
			{diff.truncated ? <p className="chg-note">{t("panel.truncatedDiff")}</p> : null}
			<div className="diff-scroll">
				<div className="diff-body">
					{patchLines(diff.patch).map(({ key, line, number }) => (
						<div key={key} className={`diff-line ${lineClass(line)}`}>
							<i>{number}</i>
							<span>{line}</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
