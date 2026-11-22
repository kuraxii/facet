/**
 * 变更标签：工作树相对 HEAD 的改动。
 *
 * 只看高频的工作区态：已暂存与未暂存合成一份的文件清单、单文件补丁预览，以及两个钻取
 * 入口。提交历史不在这里——那是低频的历史态，归「提交图谱」。
 *
 * 右栏宽到 `WORKSPACE_SPLIT_WIDE_WIDTH_PX` 时是「左补丁、右文件列表」两栏；更窄时改成
 * 单栏钻取：先满宽看列表，点一条进满宽补丁，补丁顶栏左上的箭头退回列表。
 */
import type { GitFileChange } from "@facet/protocol";
import {
	ChangesDocument,
	ChangesPane,
	ICON_SIZE,
	IconButton,
	useHoverTip,
	useI18n,
	WorkspaceSplit,
	type WorkspaceSplitView,
} from "@facet/ui";
import { ArrowLeft, PanelRightOpen } from "lucide-react";
import { type ReactNode, useState } from "react";
import type { WorkspaceDocs } from "../../hooks/useWorkspaceDocs.ts";
import { useHostClient } from "../../host-context.tsx";

/** 变更标签的参数。 */
export interface ChangesTabProps {
	/** 文档数据 */
	docs: WorkspaceDocs;
	/** 当前会话所在的目录；没有会话时为空 */
	sessionCwd: string | undefined;
	/** 两栏态索引栏的宽度 */
	listWidth: number;
	/** 松手时提交索引栏宽度 */
	onListWidthChange: (width: number) => void;
}

/** 变更标签。 */
export function ChangesTab({ docs, sessionCwd, listWidth, onListWidthChange }: ChangesTabProps): ReactNode {
	const { t } = useI18n();
	const client = useHostClient();
	/** 文件列表是不是被手动收起了（只在两栏态有意义） */
	const [isListCollapsed, setIsListCollapsed] = useState(false);
	/**
	 * 单栏钻取停在哪一层。
	 *
	 * 两栏态忽略它：宽到放得下两栏时预览与索引一起显示，钻取状态留着不影响观感，缩窄回来
	 * 还停在用户最后看的那一层。
	 */
	const [view, setView] = useState<WorkspaceSplitView>("list");

	const detail = (
		<ChangesDocument
			status={docs.changes.status}
			error={docs.changes.error}
			focusPath={docs.changesFocus?.path}
			focusRequestId={docs.changesFocus?.requestId}
			loadDiff={(file: GitFileChange) =>
				sessionCwd === undefined
					? Promise.reject(new Error(t("app.noSession")))
					: client.gitDiff(sessionCwd, file.path, file.status === "untracked")
			}
			onRefresh={() => void docs.refreshChanges({ force: true })}
			toolbarLeading={<BackToListButton onBack={() => setView("list")} />}
			toolbarTrailing={
				isListCollapsed ? (
					<RestoreListButton label={t("panel.showChanges")} onShow={() => setIsListCollapsed(false)} />
				) : null
			}
		/>
	);

	return (
		<WorkspaceSplit
			className="is-changes"
			view={view}
			isListCollapsed={isListCollapsed}
			listWidth={listWidth}
			onListWidthChange={onListWidthChange}
			detail={detail}
			list={
				<ChangesPane
					status={docs.changes.status}
					error={docs.changes.error}
					onRefresh={() => void docs.refreshChanges({ force: true })}
					onOpenDiff={(file) => {
						docs.focusDiff(file);
						setView("detail");
					}}
					onCollapse={() => setIsListCollapsed(true)}
				/>
			}
		/>
	);
}

/**
 * 退回列表的小按钮。
 *
 * 只在变更视图的单栏钻取里出现（两栏态由容器查询藏起来）：那时列表不在屏幕上，顶栏左端
 * 这枚向左的箭头就是唯一的退路。
 */
function BackToListButton({ onBack }: { onBack: () => void }): ReactNode {
	const { t } = useI18n();
	const label = t("panel.backToList");
	const tip = useHoverTip();
	return (
		<>
			<IconButton
				variant="ghost"
				size="sm"
				className="workspace-back"
				aria-label={label}
				{...tip.handlers(label)}
				onClick={onBack}
			>
				<ArrowLeft size={ICON_SIZE.md} />
			</IconButton>
			{tip.render()}
		</>
	);
}

/**
 * 把变更列表叫回来的小按钮。
 *
 * 图标指向右侧：列表在右边，展开它就是让内容从右侧长出来。两栏态才有「收起」这回事，
 * 单栏态由容器查询藏起来。
 */
function RestoreListButton({ label, onShow }: { label: string; onShow: () => void }): ReactNode {
	const tip = useHoverTip();
	return (
		<>
			<IconButton
				variant="ghost"
				size="sm"
				className="workspace-head-action workspace-restore-list"
				aria-label={label}
				{...tip.handlers(label)}
				onClick={onShow}
			>
				<PanelRightOpen size={ICON_SIZE.md} />
			</IconButton>
			{tip.render()}
		</>
	);
}
