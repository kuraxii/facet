/**
 * ACP 会话底栏的模式与动态配置项芯片。
 *
 * 与 Pi 的固定「模型 + 思考档位」芯片分开维护：直接复用 `.chip` / `.chip-wrap` / `.chip-pop`
 * 几何，将 ACP 服务端下发的 `mode` 与 `configOptions` 渲染为可交互的下拉芯片。
 */
import type { AcpConfigOption, AcpModeState } from "@facet/protocol";
import { type ReactNode, useEffect } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ChevronIcon } from "../transcript/chevron.tsx";
import { groupConfigChoices } from "./agents-model.ts";

/** ACP 配置芯片参数。 */
export interface AcpConfigChipsProps {
	/** 当前打开的菜单标识，与 Composer 共用单开浮层状态 */
	openMenuId: string | undefined;
	/** 切换打开的菜单 */
	onToggleMenu: (menuId: string | undefined) => void;
	/** 会话模式状态 */
	acpMode?: AcpModeState;
	/** 会话动态配置项 */
	acpConfigOptions?: readonly AcpConfigOption[];
	/** 切换会话模式 */
	onAcpModeChange?: (modeId: string) => void;
	/** 修改动态配置项 */
	onAcpConfigOptionChange?: (configId: string, value: string) => void;
}

export function AcpConfigChips({
	openMenuId,
	onToggleMenu,
	acpMode,
	acpConfigOptions = [],
	onAcpModeChange,
	onAcpConfigOptionChange,
}: AcpConfigChipsProps): ReactNode {
	const { t } = useI18n();
	const isAcpMenuOpen = openMenuId?.startsWith("acp-") === true;

	useEffect(() => {
		if (!isAcpMenuOpen) {
			return;
		}
		const onPointerDown = (event: PointerEvent): void => {
			if (event.target instanceof Element && event.target.closest("[data-acp-chip]") !== null) {
				return;
			}
			onToggleMenu(undefined);
		};
		document.addEventListener("pointerdown", onPointerDown);
		return () => document.removeEventListener("pointerdown", onPointerDown);
	}, [isAcpMenuOpen, onToggleMenu]);

	const hasMode = acpMode !== undefined && acpMode.availableModes.length > 0;
	const currentMode = acpMode?.availableModes.find((m) => m.id === acpMode.currentModeId);
	const modeMenuId = "acp-mode";
	const visibleConfigOptions = acpConfigOptions.filter((option) => option.category !== "mode");

	return (
		<>
			{!hasMode ? null : (
				<div className="chip-wrap" data-acp-chip>
					<button
						type="button"
						className="chip"
						disabled={onAcpModeChange === undefined}
						aria-expanded={openMenuId === modeMenuId}
						onClick={() => onToggleMenu(openMenuId === modeMenuId ? undefined : modeMenuId)}
					>
						<span>{currentMode?.name ?? acpMode.currentModeId ?? t("composer.acpMode")}</span>
						{onAcpModeChange !== undefined ? <ChevronIcon isOpen={openMenuId === modeMenuId} /> : null}
					</button>
					{openMenuId === modeMenuId ? (
						// biome-ignore lint/a11y/useSemanticElements: 浮层里是一组选项按钮
						<div className="chip-pop" role="group" aria-label={t("composer.acpChooseMode")}>
							{acpMode.availableModes.map((mode) => (
								<button
									type="button"
									key={mode.id}
									className={mode.id === acpMode.currentModeId ? "chip-pop-item is-on" : "chip-pop-item"}
									onClick={() => {
										onAcpModeChange?.(mode.id);
										onToggleMenu(undefined);
									}}
								>
									<span className="ell">{mode.name}</span>
								</button>
							))}
						</div>
					) : null}
				</div>
			)}

			{visibleConfigOptions.map((option) => {
				const menuId = `acp-opt:${option.id}`;
				const activeChoice = option.options.find((c) => c.value === option.currentValue);
				const grouped = groupConfigChoices(option.options);
				const canEdit = onAcpConfigOptionChange !== undefined && option.options.length > 0;
				return (
					<div key={option.id} className="chip-wrap" data-acp-chip>
						<button
							type="button"
							className="chip"
							disabled={!canEdit}
							aria-expanded={openMenuId === menuId}
							onClick={() => onToggleMenu(openMenuId === menuId ? undefined : menuId)}
						>
							<span className="ell">{activeChoice?.name ?? option.currentValue}</span>
							{canEdit ? <ChevronIcon isOpen={openMenuId === menuId} /> : null}
						</button>
						{openMenuId === menuId ? (
							// biome-ignore lint/a11y/useSemanticElements: 浮层里是一组选项按钮
							<div className="chip-pop" role="group" aria-label={option.name}>
								{grouped.map(([groupName, items]) => (
									<div key={groupName ?? "__default"} className="chip-pop-group">
										{groupName === undefined ? null : <p className="chip-pop-head">{groupName}</p>}
										{items.map((choice) => (
											<button
												type="button"
												key={choice.value}
												className={
													choice.value === option.currentValue ? "chip-pop-item is-on" : "chip-pop-item"
												}
												onClick={() => {
													onAcpConfigOptionChange?.(option.id, choice.value);
													onToggleMenu(undefined);
												}}
											>
												<span className="ell">{choice.name}</span>
											</button>
										))}
									</div>
								))}
								{option.options.length === 0 ? (
									<p className="chip-pop-empty">{t("composer.acpNoOptions")}</p>
								) : null}
							</div>
						) : null}
					</div>
				);
			})}
		</>
	);
}
