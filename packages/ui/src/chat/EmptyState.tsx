/**
 * 未关联会话时的新建引导页。
 *
 * 居中展示欢迎语与输入区（复用对话区的 Composer），支持独立选择 Host（当前仅本地）、
 * Project 与 Agent，发送首条消息时才真正创建并打开会话。
 */
import type {
	AgentAvailability,
	AgentCapabilities,
	ModelInfo,
	ProjectInfo,
	ThinkingLevel,
} from "@facet/protocol";
import { Folder, FolderPlus, Monitor } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { BackendIcon } from "./AgentsIcon.tsx";
import { Composer } from "./Composer.tsx";
import { baseName } from "./sidebar-model.ts";

/** 引导页参数。 */
export interface EmptyStateProps {
	/** 本机 Host 展示名（目前仅支持本地 Host） */
	hostName: string;
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
}

type OpenMenu = "host" | "project" | "agent" | undefined;

export function EmptyState({
	hostName,
	cwd,
	projects,
	agents,
	selectedAgentId,
	onSelectCwd,
	onSelectAgent,
	canCreate,
	onSend,
	onAddProject,
	shiftEnterToSend = false,
	model,
	models,
	thinkingLevel,
	thinkingLevels,
	providerAuth,
	onModelChange,
	onThinkingLevelChange,
	capabilities,
}: EmptyStateProps) {
	const { t } = useI18n();
	const [draft, setDraft] = useState("");
	const [openMenu, setOpenMenu] = useState<OpenMenu>(undefined);
	const barRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (openMenu === undefined) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			if (event.target instanceof Node && barRef.current?.contains(event.target)) {
				return;
			}
			setOpenMenu(undefined);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [openMenu]);

	const projectName = cwd !== undefined && cwd.length > 0 ? baseName(cwd) || cwd : undefined;
	const activeAgent = agents.find((item) => item.id === selectedAgentId) ?? agents[0];

	const submit = (): void => {
		const trimmed = draft.trim();
		if (!canCreate || trimmed.length === 0) {
			return;
		}
		setDraft("");
		onSend(trimmed);
	};

	const selectorsHeader = (
		<div className="empty-selectors" ref={barRef}>
			<div className="chip-wrap">
				<button
					type="button"
					className="chip"
					aria-label={t("empty.selectHost")}
					aria-expanded={openMenu === "host"}
					onClick={() => setOpenMenu((cur) => (cur === "host" ? undefined : "host"))}
				>
					<Monitor size={ICON_SIZE.sm} />
					<span className="ell">{hostName}</span>
					<ChevronIcon isOpen={openMenu === "host"} />
				</button>
				{openMenu === "host" ? (
					// biome-ignore lint/a11y/useSemanticElements: 浮层里是 Host 选项列表
					<div className="chip-pop" role="group" aria-label={t("empty.selectHost")}>
						<button type="button" className="chip-pop-item is-on" onClick={() => setOpenMenu(undefined)}>
							<span className="ell">{hostName}</span>
						</button>
					</div>
				) : null}
			</div>

			<div className="chip-wrap">
				<button
					type="button"
					className="chip"
					aria-label={t("empty.selectProject")}
					aria-expanded={openMenu === "project"}
					onClick={() => setOpenMenu((cur) => (cur === "project" ? undefined : "project"))}
				>
					<Folder size={ICON_SIZE.sm} />
					<span className="ell">{projectName ?? t("empty.noProject")}</span>
					<ChevronIcon isOpen={openMenu === "project"} />
				</button>
				{openMenu === "project" ? (
					// biome-ignore lint/a11y/useSemanticElements: 浮层里是项目选项列表
					<div className="chip-pop" role="group" aria-label={t("empty.selectProject")}>
						<button
							type="button"
							className={cwd === undefined ? "chip-pop-item is-on" : "chip-pop-item"}
							onClick={() => {
								onSelectCwd(undefined);
								setOpenMenu(undefined);
							}}
						>
							<span className="ell">{t("empty.noProject")}</span>
						</button>
						{projects.map((project) => (
							<button
								type="button"
								key={project.id}
								className={project.cwd === cwd ? "chip-pop-item is-on" : "chip-pop-item"}
								onClick={() => {
									onSelectCwd(project.cwd);
									setOpenMenu(undefined);
								}}
							>
								<span className="ell">{baseName(project.cwd) || project.cwd}</span>
							</button>
						))}
						<button
							type="button"
							className="chip-pop-item"
							onClick={() => {
								setOpenMenu(undefined);
								onAddProject();
							}}
						>
							<FolderPlus size={ICON_SIZE.sm} />
							<span className="ell">{t("common.addProject")}</span>
						</button>
					</div>
				) : null}
			</div>

			<div className="chip-wrap">
				<button
					type="button"
					className="chip"
					aria-label={t("empty.selectAgent")}
					aria-expanded={openMenu === "agent"}
					onClick={() => setOpenMenu((cur) => (cur === "agent" ? undefined : "agent"))}
				>
					<BackendIcon agentId={selectedAgentId} size={ICON_SIZE.sm} />
					<span className="ell">{activeAgent?.name ?? selectedAgentId}</span>
					<ChevronIcon isOpen={openMenu === "agent"} />
				</button>
				{openMenu === "agent" ? (
					// biome-ignore lint/a11y/useSemanticElements: 浮层里是 Agent 选项列表
					<div className="chip-pop" role="group" aria-label={t("empty.selectAgent")}>
						{agents.map((agent) => (
							<button
								type="button"
								key={agent.id}
								disabled={!agent.enabled || !agent.available}
								className={agent.id === selectedAgentId ? "chip-pop-item is-on" : "chip-pop-item"}
								onClick={() => {
									onSelectAgent(agent.id);
									setOpenMenu(undefined);
								}}
							>
								<BackendIcon agentId={agent.id} size={ICON_SIZE.sm} />
								<span className="ell">{agent.name}</span>
							</button>
						))}
					</div>
				) : null}
			</div>
		</div>
	);

	return (
		<div className="empty-main">
			<h1 className="empty-title">
				{projectName === undefined ? t("empty.title") : t("empty.titleInProject", { project: projectName })}
			</h1>

			<Composer
				header={selectorsHeader}
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
				shiftEnterToSend={shiftEnterToSend}
				isBlocked={!canCreate}
			/>
		</div>
	);
}
