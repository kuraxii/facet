/**
 * 未关联会话时的新建引导页。
 *
 * 居中展示欢迎语与输入区（复用对话区的 Composer），支持独立选择 Host（含连接触发）、
 * Project（含内联管理与最近上下文）与 Agent，发送首条消息时才真正创建并打开会话。
 */
import type {
	AcpConfigOption,
	AcpModeState,
	AgentAvailability,
	AgentCapabilities,
	ModelInfo,
	ProjectInfo,
	ThinkingLevel,
} from "@facet/protocol";
import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Composer, type ComposerAttachment } from "./Composer.tsx";
import { type DraftHostOption, DraftSelectors } from "./DraftSelectors.tsx";
import type { RecentDraftContext } from "./draft-context.ts";
import { baseName, isScratchCwd } from "./sidebar-model.ts";

/** 引导页参数。 */
export interface EmptyStateProps {
	/** 当前选定 Host 展示名 */
	hostName: string;
	/** 可选 Host 节点清单（本机与已配置远端） */
	hosts?: readonly DraftHostOption[];
	/** 当前引导页选定的 Host 端点 */
	selectedHostEndpoint?: string;
	/** 切换引导页目标 Host */
	onSelectHost?: (endpoint: string) => void;
	/** 当前选中的项目目录；缺省表示未关联项目 */
	cwd: string | undefined;
	/** 可选项目列表 */
	projects: readonly ProjectInfo[];
	/** 可选 Agent 列表 */
	agents: readonly AgentAvailability[];
	/** 当前选中的 Agent 标识 */
	selectedAgentId: string;
	/** 切换项目目录 */
	onSelectCwd: (cwd: string | undefined) => void;
	/** 切换 Agent */
	onSelectAgent: (agentId: string) => void;
	/** 新建会话是否可用 */
	canCreate: boolean;
	/** 发送首条消息：由上层创建会话并投递 */
	onSend: (text: string) => void;
	/** 打开添加项目对话框 */
	onAddProject: () => void;
	/** 在下拉内就地重命名项目 */
	onRenameProject?: (id: string, name: string) => Promise<void>;
	/** 在下拉内移除项目 */
	onRemoveProject?: (id: string) => Promise<void>;
	/** 在系统文件管理器打开项目目录 */
	onRevealProject?: (id: string) => Promise<void>;
	/** 最近使用过的上下文组合（2-3 条） */
	recentContexts?: readonly RecentDraftContext[];
	/** 一键恢复最近上下文 */
	onSelectRecentContext?: (ctx: RecentDraftContext) => void;
	/** 发送键位：true 表示 Shift+回车发送 */
	shiftEnterToSend?: boolean;
	/** 当前模型 */
	model?: ModelInfo | undefined;
	/** 可选模型列表 */
	models?: readonly ModelInfo[];
	/** 当前思考档位 */
	thinkingLevel?: ThinkingLevel | undefined;
	/** 当前模型可选的思考档位 */
	thinkingLevels?: readonly ThinkingLevel[];
	/** 提供方是否已配置凭证 */
	providerAuth?: Readonly<Record<string, boolean>>;
	/** 切换模型 */
	onModelChange?: (model: ModelInfo) => void;
	/** 切换思考档位 */
	onThinkingLevelChange?: (level: ThinkingLevel) => void;
	/** 当前 Agent 能力集合 */
	capabilities?: AgentCapabilities;
	/** 待发图片附件 */
	attachments?: readonly ComposerAttachment[];
	/** 打开系统选图窗口 */
	onPickImages?: (() => void) | undefined;
	/** 加入图片附件（粘贴/拖拽） */
	onAddImages?: ((files: readonly File[]) => void) | undefined;
	/** 是否允许添加图片 */
	canAddImages?: boolean;
	/** 移除待发图片 */
	onRemoveAttachment?: ((id: string) => void) | undefined;
	/** 图片附加提示 */
	attachmentNotice?: string | undefined;
	/** 可 `@` 引用的项目文件列表 */
	mentionFiles?: readonly string[];
	/** ACP 会话模式状态 */
	acpMode?: AcpModeState;
	/** ACP 动态配置项 */
	acpConfigOptions?: readonly AcpConfigOption[];
	/** 切换 ACP 会话模式 */
	onAcpModeChange?: (modeId: string) => void;
	/** 修改 ACP 动态配置项 */
	onAcpConfigOptionChange?: (configId: string, value: string) => void;
}

export function EmptyState({
	hostName,
	hosts,
	selectedHostEndpoint,
	onSelectHost,
	cwd,
	projects,
	agents,
	selectedAgentId,
	onSelectCwd,
	onSelectAgent,
	canCreate,
	onSend,
	onAddProject,
	onRenameProject,
	onRemoveProject,
	onRevealProject,
	recentContexts,
	onSelectRecentContext,
	shiftEnterToSend = false,
	model,
	models,
	thinkingLevel,
	thinkingLevels,
	providerAuth,
	onModelChange,
	onThinkingLevelChange,
	capabilities,
	attachments,
	onPickImages,
	onAddImages,
	canAddImages,
	onRemoveAttachment,
	attachmentNotice,
	mentionFiles,
	acpMode,
	acpConfigOptions,
	onAcpModeChange,
	onAcpConfigOptionChange,
}: EmptyStateProps) {
	const { t } = useI18n();
	const [draft, setDraft] = useState("");
	const projectName =
		cwd !== undefined && cwd.length > 0 && !isScratchCwd(cwd) ? baseName(cwd) || cwd : undefined;

	const submit = (): void => {
		const trimmed = draft.trim();
		if (!canCreate || trimmed.length === 0) {
			return;
		}
		setDraft("");
		onSend(trimmed);
	};

	return (
		<div className="empty-main">
			<h1 className="empty-title">
				{projectName === undefined ? t("empty.title") : t("empty.titleInProject", { project: projectName })}
			</h1>

			<Composer
				header={
					<DraftSelectors
						hostName={hostName}
						hosts={hosts}
						selectedHostEndpoint={selectedHostEndpoint}
						onSelectHost={onSelectHost}
						cwd={cwd}
						projects={projects}
						onSelectCwd={onSelectCwd}
						onAddProject={onAddProject}
						onRenameProject={onRenameProject}
						onRemoveProject={onRemoveProject}
						onRevealProject={onRevealProject}
						agents={agents}
						selectedAgentId={selectedAgentId}
						onSelectAgent={onSelectAgent}
						recentContexts={recentContexts}
						onSelectRecentContext={onSelectRecentContext}
					/>
				}
				showStatusChips={false}
				value={draft}
				onChange={setDraft}
				onSend={submit}
				onStop={() => {}}
				activity="idle"
				model={model}
				models={models}
				thinkingLevel={thinkingLevel}
				thinkingLevels={thinkingLevels}
				providerAuth={providerAuth}
				onModelChange={onModelChange}
				onThinkingLevelChange={onThinkingLevelChange}
				capabilities={capabilities}
				attachments={attachments}
				onPickImages={onPickImages}
				onAddImages={onAddImages}
				canAddImages={canAddImages}
				onRemoveAttachment={onRemoveAttachment}
				attachmentNotice={attachmentNotice}
				mentionFiles={mentionFiles}
				acpMode={acpMode}
				acpConfigOptions={acpConfigOptions}
				onAcpModeChange={onAcpModeChange}
				onAcpConfigOptionChange={onAcpConfigOptionChange}
				shiftEnterToSend={shiftEnterToSend}
				isBlocked={!canCreate}
			/>
		</div>
	);
}
