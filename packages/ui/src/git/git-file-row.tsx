/**
 * 一个文件在改动清单里的那一行。
 *
 * 变更页的文件树与提交详情的文件列表共用它：图标、名字、增删行数与状态图形都在这一处，
 * 两边只是外层容器不同。
 */
import type { GitFileChange } from "@facet/protocol";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { useHoverTip } from "../tip.tsx";
import styles from "./git.module.css";
import { ChangeMark, changeStatusLabelKey } from "./git-status-mark.tsx";

/** 文件行的参数。 */
export interface GitFileRowProps {
	/** 改动清单里的一项 */
	file: GitFileChange;
	/** 是不是当前选中的那一项 */
	isSelected?: boolean;
	/** 点这一行；不给时它只是展示 */
	onSelect?: ((file: GitFileChange) => void) | undefined;
}

/** 文件名之外的那一段目录；顶层文件为空。 */
function directoryOf(path: string): string {
	const index = path.lastIndexOf("/");
	return index < 0 ? "" : path.slice(0, index);
}

/** 文件行；整条可点，悬停给完整路径。 */
export function GitFileRow({ file, isSelected = false, onSelect }: GitFileRowProps): ReactNode {
	const { t } = useI18n();
	const tip = useHoverTip();
	const statusLabel = t(changeStatusLabelKey(file.status));
	const name = file.path.split("/").pop() ?? file.path;
	const dir = directoryOf(file.path);
	return (
		<>
			<button
				type="button"
				className={styles.fileRow}
				data-selected={isSelected}
				data-path={file.path}
				{...tip.handlers(file.path)}
				onClick={() => onSelect?.(file)}
			>
				<FileText className={styles.fileIcon} size={14} strokeWidth={1.5} />
				<span className={styles.fileName}>{name}</span>
				{dir.length === 0 ? null : <span className={styles.fileDir}>{dir}</span>}
				{file.binary ? (
					<span className={styles.fileBinary}>{t("panel.binary")}</span>
				) : (
					<span className={styles.fileStats}>
						<b className={styles.add}>+{file.added}</b>
						<b className={styles.del}>−{file.removed}</b>
					</span>
				)}
				<span className={styles.fileMark} data-status={file.status} role="img" aria-label={statusLabel}>
					<ChangeMark status={file.status} />
				</span>
			</button>
			{tip.render()}
		</>
	);
}
