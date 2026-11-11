/**
 * 没有打开任何会话时的引导页。
 *
 * 有项目时给新建会话的入口并说明会建在哪个目录；没有项目时先引导添加项目，新建按钮置灰。
 */
import { FolderPlusIcon, PlusIcon } from "../transcript/icons.tsx";

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
	return (
		<div className="empty-main">
			<h1 className="empty-title">开始一个新会话</h1>
			<p className="empty-hint">
				{cwd === undefined ? "先添加一个项目,会话会在项目目录里创建。" : `会话会在 ${cwd} 里创建。`}
			</p>
			<div className="empty-actions">
				<button
					type="button"
					className="empty-primary"
					onClick={onCreate}
					disabled={!canCreate || cwd === undefined}
				>
					<PlusIcon size={14} />
					新建会话
				</button>
				<button type="button" className="empty-secondary" onClick={onAddProject}>
					<FolderPlusIcon size={14} />
					添加项目
				</button>
			</div>
		</div>
	);
}
