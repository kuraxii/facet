/**
 * 没有打开任何会话时的引导页。
 *
 * 有项目时给新建会话的入口并说明会建在哪个目录；没有项目时先引导添加项目，新建按钮置灰。
 */

import { FolderPlus, Plus } from "lucide-react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";

/** 引导页参数。 */
export interface EmptyStateProps {
	/** 新建会话会落在的目录，没有可用项目时为空 */
	cwd: string | undefined;
	/** 新建会话是否可用 */
	canCreate: boolean;
	/** 新建会话 */
	onCreate: () => void;
	/** 添加项目 */
	onAddProject: () => void;
}

export function EmptyState({ cwd, canCreate, onCreate, onAddProject }: EmptyStateProps) {
	const { t } = useI18n();
	return (
		<div className="empty-main">
			<h1 className="empty-title">{t("empty.title")}</h1>
			<p className="empty-hint">
				{cwd === undefined ? t("empty.addProjectHint") : t("empty.createHint", { cwd })}
			</p>
			<div className="empty-actions">
				<button
					type="button"
					className="empty-primary"
					onClick={onCreate}
					disabled={!canCreate || cwd === undefined}
				>
					<Plus size={ICON_SIZE.md} />
					{t("common.newSession")}
				</button>
				<button type="button" className="empty-secondary" onClick={onAddProject}>
					<FolderPlus size={ICON_SIZE.md} />
					{t("common.addProject")}
				</button>
			</div>
		</div>
	);
}
