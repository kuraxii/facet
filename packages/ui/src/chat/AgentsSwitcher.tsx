/**
 * 侧栏页脚的代理后端切换器。
 *
 * 复用 `host-switch` / `host-pop` 浮层几何与状态点，点击后在 `Pi` 与各 ACP 后端间切换
 * 侧栏列表及「新建会话」归属，不打断右侧正打开的会话。
 */
import { type AgentAvailability, PI_AGENT_ID } from "@facet/protocol";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../common/Button.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";
import { BackendIcon } from "./AgentsIcon.tsx";

/** Agent 切换器参数。 */
export interface AgentsSwitcherProps {
	/** Host 上报的可用 Agent 列表 */
	agents: readonly AgentAvailability[];
	/** 当前选中的侧栏 Agent 标识 */
	selectedAgentId: string;
	/** 选中某个 Agent */
	onSelect: (agentId: string) => void;
}

export function AgentsSwitcher({ agents, selectedAgentId, onSelect }: AgentsSwitcherProps): ReactNode {
	const { t } = useI18n();
	const tip = useHoverTip();
	const [isOpen, setIsOpen] = useState(false);
	const wrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			const node = wrapRef.current;
			if (node !== null && event.target instanceof Node && node.contains(event.target)) {
				return;
			}
			setIsOpen(false);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [isOpen]);

	const active = agents.find((item) => item.id === selectedAgentId) ?? agents[0];
	const activeLabel = active?.name ?? (selectedAgentId === PI_AGENT_ID ? "Pi" : selectedAgentId);

	return (
		<div className="host-switch" ref={wrapRef}>
			<Button
				variant="ghost"
				size="sm"
				className="sb-foot-btn"
				aria-label={t("sidebar.agentSwitch")}
				aria-expanded={isOpen}
				{...tip.handlers(t("sidebar.agentSwitch"))}
				onClick={() => setIsOpen((open) => !open)}
			>
				<BackendIcon agentId={selectedAgentId} size={ICON_SIZE.md} />
				<span className="ell">{activeLabel}</span>
			</Button>
			{isOpen ? (
				// biome-ignore lint/a11y/useSemanticElements: 浮层里是一份 Agent 列表，不需要 fieldset 语义
				<div className="host-pop" role="group" aria-label={t("sidebar.agentList")}>
					<ul className="host-list">
						{agents.map((agent) => {
							const isSelected = agent.id === selectedAgentId;
							const statusText = !agent.enabled
								? t("sidebar.agentDisabled")
								: !agent.available
									? t("sidebar.agentUnavailable")
									: undefined;
							return (
								<li key={agent.id} className={isSelected ? "host-row is-on" : "host-row"}>
									<button
										type="button"
										className="host-main"
										onClick={() => {
											onSelect(agent.id);
											setIsOpen(false);
										}}
									>
										<i className={agent.available ? "dot" : "dot is-off"} />
										<span className="host-name">{agent.name}</span>
										{statusText === undefined ? null : <span className="host-addr mono">{statusText}</span>}
									</button>
								</li>
							);
						})}
					</ul>
				</div>
			) : null}
			{tip.render()}
		</div>
	);
}
