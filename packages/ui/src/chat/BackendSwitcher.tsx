/**
 * 侧栏页脚的代理后端切换器。
 *
 * 复用 `host-switch` / `host-pop` 浮层几何与状态点，点击后在 `Pi` 与各 ACP 后端间切换
 * 侧栏列表及「新建会话」归属，不打断右侧正打开的会话。
 */
import { type BackendAvailability, PI_BACKEND_ID } from "@facet/protocol";
import { Bot } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../common/Button.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { useHoverTip } from "../tip.tsx";

/** 代理后端切换器参数。 */
export interface BackendSwitcherProps {
	/** 主机上报的可用后端列表 */
	backends: readonly BackendAvailability[];
	/** 当前选中的侧栏后端标识 */
	selectedBackendId: string;
	/** 选中某个后端 */
	onSelect: (backendId: string) => void;
}

export function BackendSwitcher({ backends, selectedBackendId, onSelect }: BackendSwitcherProps): ReactNode {
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

	const active = backends.find((item) => item.id === selectedBackendId) ?? backends[0];
	const activeLabel = active?.name ?? (selectedBackendId === PI_BACKEND_ID ? "Pi" : selectedBackendId);

	return (
		<div className="host-switch" ref={wrapRef}>
			<Button
				variant="ghost"
				size="sm"
				className="sb-foot-btn"
				aria-label={t("sidebar.backendSwitch")}
				aria-expanded={isOpen}
				{...tip.handlers(t("sidebar.backendSwitch"))}
				onClick={() => setIsOpen((open) => !open)}
			>
				<Bot size={ICON_SIZE.md} />
				<span className="ell">{activeLabel}</span>
			</Button>
			{isOpen ? (
				// biome-ignore lint/a11y/useSemanticElements: 浮层里是一份代理后端列表，不需要 fieldset 语义
				<div className="host-pop" role="group" aria-label={t("sidebar.backendList")}>
					<ul className="host-list">
						{backends.map((backend) => {
							const isSelected = backend.id === selectedBackendId;
							const statusText = !backend.enabled
								? t("sidebar.backendDisabled")
								: !backend.available
									? t("sidebar.backendUnavailable")
									: backend.kind.toUpperCase();
							return (
								<li key={backend.id} className={isSelected ? "host-row is-on" : "host-row"}>
									<button
										type="button"
										className="host-main"
										onClick={() => {
											onSelect(backend.id);
											setIsOpen(false);
										}}
									>
										<i className={backend.available ? "dot" : "dot is-off"} />
										<span className="host-name">{backend.name}</span>
										<span className="host-addr mono">{statusText}</span>
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
