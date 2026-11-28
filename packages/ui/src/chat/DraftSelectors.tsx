/**
 * 新建会话引导页顶部的 Host / Project（含项目管理）/ Agent 选择器与最近上下文快捷栏。
 */
import type { AgentAvailability, ProjectInfo } from "@facet/protocol";
import { Check, Folder, FolderOpen, FolderPlus, Monitor, Pencil, Server, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Input } from "../common/Input.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { BackendIcon } from "./AgentsIcon.tsx";
import type { RecentDraftContext } from "./draft-context.ts";
import type { HostNodePhase } from "./HostSwitcher.tsx";
import { baseName, isScratchCwd } from "./sidebar-model.ts";

/** 引导页 Host 下拉里的单个主机节点。 */
export interface DraftHostOption {
	/** 端点标识 */
	endpoint: string;
	/** 展示名 */
	name: string;
	/** 是否本机 */
	isLocal: boolean;
	/** 当前连接阶段（决定状态点样式） */
	phase: HostNodePhase;
}

export interface DraftSelectorsProps {
	hostName: string;
	hosts?: readonly DraftHostOption[];
	selectedHostEndpoint?: string;
	onSelectHost?: (endpoint: string) => void;
	cwd: string | undefined;
	projects: readonly ProjectInfo[];
	onSelectCwd: (cwd: string | undefined) => void;
	onAddProject: () => void;
	onRenameProject?: (id: string, name: string) => Promise<void>;
	onRemoveProject?: (id: string) => Promise<void>;
	onRevealProject?: (id: string) => Promise<void>;
	agents: readonly AgentAvailability[];
	selectedAgentId: string;
	onSelectAgent: (agentId: string) => void;
	recentContexts?: readonly RecentDraftContext[];
	onSelectRecentContext?: (ctx: RecentDraftContext) => void;
}

type OpenMenu = "host" | "project" | "agent" | undefined;

function dotClassFor(phase: HostNodePhase): string {
	if (phase === "ready") return "host-dot is-ready";
	if (phase === "connecting" || phase === "auth") return "host-dot is-busy";
	if (phase === "failed") return "host-dot is-failed";
	return "host-dot";
}

export function DraftSelectors({
	hostName,
	hosts,
	selectedHostEndpoint,
	onSelectHost,
	cwd,
	projects,
	onSelectCwd,
	onAddProject,
	onRenameProject,
	onRemoveProject,
	onRevealProject,
	agents,
	selectedAgentId,
	onSelectAgent,
	recentContexts,
	onSelectRecentContext,
}: DraftSelectorsProps) {
	const { t } = useI18n();
	const [openMenu, setOpenMenu] = useState<OpenMenu>(undefined);
	const [editingProjectId, setEditingProjectId] = useState<string | undefined>(undefined);
	const [editName, setEditName] = useState("");
	const barRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (openMenu === undefined) {
			setEditingProjectId(undefined);
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

	const projectName =
		cwd !== undefined && cwd.length > 0 && !isScratchCwd(cwd) ? baseName(cwd) || cwd : undefined;
	const activeAgent = agents.find((item) => item.id === selectedAgentId) ?? agents[0];
	const currentHost = hosts?.find((item) => item.endpoint === selectedHostEndpoint);
	const hostList: readonly DraftHostOption[] =
		hosts !== undefined && hosts.length > 0
			? hosts
			: [
					{
						endpoint: selectedHostEndpoint ?? "local",
						name: hostName,
						isLocal: true,
						phase: "ready",
					},
				];

	const commitRename = async (id: string): Promise<void> => {
		const trimmed = editName.trim();
		setEditingProjectId(undefined);
		if (trimmed.length === 0 || onRenameProject === undefined) {
			return;
		}
		await onRenameProject(id, trimmed).catch(() => undefined);
	};

	return (
		<div className="empty-selectors" ref={barRef}>
			<div className="chip-wrap">
				<button
					type="button"
					className="chip"
					aria-label={t("empty.selectHost")}
					aria-expanded={openMenu === "host"}
					onClick={() => setOpenMenu((cur) => (cur === "host" ? undefined : "host"))}
				>
					{currentHost === undefined || currentHost.isLocal ? (
						<Monitor size={ICON_SIZE.sm} />
					) : (
						<Server size={ICON_SIZE.sm} />
					)}
					<span className="ell">{currentHost?.name ?? hostName}</span>
					{currentHost !== undefined && !currentHost.isLocal ? (
						<span className={dotClassFor(currentHost.phase)} aria-hidden="true" />
					) : null}
					<ChevronIcon isOpen={openMenu === "host"} />
				</button>
				{openMenu === "host" ? (
					// biome-ignore lint/a11y/useSemanticElements: Host 选项列表
					<div className="chip-pop" role="group" aria-label={t("empty.selectHost")}>
						{hostList.map((item) => {
							const active = item.endpoint === (selectedHostEndpoint ?? item.endpoint);
							return (
								<button
									type="button"
									key={item.endpoint}
									className={active ? "chip-pop-item is-on" : "chip-pop-item"}
									onClick={() => {
										onSelectHost?.(item.endpoint);
										setOpenMenu(undefined);
									}}
								>
									<span className="chip-pop-row">
										<span className={dotClassFor(item.phase)} aria-hidden="true" />
										<span className="ell">{item.name}</span>
									</span>
								</button>
							);
						})}
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
					// biome-ignore lint/a11y/useSemanticElements: Project 列表与管理操作
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
						{projects.map((project) => {
							const label = baseName(project.cwd) || project.cwd;
							if (editingProjectId === project.id) {
								return (
									<div key={project.id} className="draft-proj-edit">
										<Input
											size="sm"
											value={editName}
											autoFocus
											onChange={(e) => setEditName(e.target.value)}
											onKeyDown={(e) => {
												if (e.key === "Enter" && !isComposingKey(e)) {
													e.preventDefault();
													void commitRename(project.id);
												} else if (e.key === "Escape") {
													setEditingProjectId(undefined);
												}
											}}
										/>
										<button
											type="button"
											className="draft-proj-act"
											aria-label={t("common.save")}
											onClick={() => void commitRename(project.id)}
										>
											<Check size={ICON_SIZE.sm} />
										</button>
										<button
											type="button"
											className="draft-proj-act"
											aria-label={t("common.cancel")}
											onClick={() => setEditingProjectId(undefined)}
										>
											<X size={ICON_SIZE.sm} />
										</button>
									</div>
								);
							}
							return (
								<div key={project.id} className="draft-proj-row">
									<button
										type="button"
										className={
											project.cwd === cwd
												? "chip-pop-item is-on draft-proj-pick"
												: "chip-pop-item draft-proj-pick"
										}
										onClick={() => {
											onSelectCwd(project.cwd);
											setOpenMenu(undefined);
										}}
									>
										<span className="ell">{label}</span>
									</button>
									{onRevealProject === undefined ? null : (
										<button
											type="button"
											className="draft-proj-act"
											aria-label={t("sidebar.revealProject")}
											onClick={() => {
												void onRevealProject(project.id).catch(() => undefined);
											}}
										>
											<FolderOpen size={ICON_SIZE.sm} />
										</button>
									)}
									{onRenameProject === undefined ? null : (
										<button
											type="button"
											className="draft-proj-act"
											aria-label={t("common.rename")}
											onClick={() => {
												setEditingProjectId(project.id);
												setEditName(project.name || label);
											}}
										>
											<Pencil size={ICON_SIZE.sm} />
										</button>
									)}
									{onRemoveProject === undefined ? null : (
										<button
											type="button"
											className="draft-proj-act is-danger"
											aria-label={t("common.delete")}
											onClick={() => {
												void onRemoveProject(project.id).catch(() => undefined);
											}}
										>
											<Trash2 size={ICON_SIZE.sm} />
										</button>
									)}
								</div>
							);
						})}
						<button
							type="button"
							className="chip-pop-item"
							onClick={() => {
								setOpenMenu(undefined);
								onAddProject();
							}}
						>
							<span className="chip-pop-row">
								<FolderPlus size={ICON_SIZE.sm} />
								<span className="ell">{t("common.addProject")}</span>
							</span>
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
					// biome-ignore lint/a11y/useSemanticElements: Agent 列表
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

			{recentContexts !== undefined && recentContexts.length > 0 && onSelectRecentContext !== undefined ? (
				<div className="empty-recents">
					{recentContexts.map((ctx) => {
						const projLabel =
							ctx.cwd !== undefined && ctx.cwd.length > 0 && !isScratchCwd(ctx.cwd)
								? baseName(ctx.cwd)
								: undefined;
						const label = projLabel ? `${ctx.hostLabel} · ${projLabel}` : ctx.hostLabel;
						return (
							<button
								type="button"
								key={`${ctx.endpoint}::${ctx.cwd ?? ""}::${ctx.agentId}`}
								className="recent-ctx-chip"
								onClick={() => onSelectRecentContext(ctx)}
							>
								<BackendIcon agentId={ctx.agentId} size={ICON_SIZE.sm} />
								<span className="ell">{label}</span>
							</button>
						);
					})}
				</div>
			) : null}
		</div>
	);
}
