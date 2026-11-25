/**
 * 设置页的输入分节。
 *
 * 发送键位改的是设置里的 `input`；快捷键一节只是把已经实现的按键列出来，不参与保存。
 */
import type { FacetSettings } from "@facet/protocol";
import { Select } from "../common/select.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { SettingsGroup, SettingsRow } from "./settings-layout.tsx";

/** 输入设置。 */
export function InputSection({
	draft,
	patch,
}: {
	draft: FacetSettings;
	patch: (change: (current: FacetSettings) => FacetSettings) => void;
}) {
	const { t } = useI18n();
	return (
		<>
			<h2 className="set-section-title">{t("settings.inputPage.title")}</h2>
			<SettingsGroup label={t("settings.inputPage.sending")}>
				<SettingsRow title={t("settings.inputPage.sendKey")}>
					<Select
						value={draft.input.sendKey}
						options={[
							{ value: "enter", label: t("settings.inputPage.enter") },
							{ value: "shiftEnter", label: t("settings.inputPage.shiftEnter") },
						]}
						onChange={(value) =>
							patch((current) => ({
								...current,
								input: { ...current.input, sendKey: value as FacetSettings["input"]["sendKey"] },
							}))
						}
						ariaLabel={t("settings.inputPage.sendKey")}
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label={t("settings.inputPage.shortcuts")}>
				{SHORTCUTS.map((item) => (
					<SettingsRow key={item.keys} title={t(item.actionKey)}>
						<span className="set-item-key mono">{item.keys}</span>
					</SettingsRow>
				))}
				<SettingsRow title={t("settings.inputPage.sendMessage")}>
					<span className="set-item-key mono">
						{draft.input.sendKey === "shiftEnter" ? "Shift+Enter" : "Enter"}
					</span>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

/** 已实现的快捷键，按使用频率排列。 */
const SHORTCUTS: ReadonlyArray<{
	keys: string;
	actionKey:
		| "settings.inputPage.expandSearch"
		| "settings.inputPage.closeOverlays"
		| "settings.inputPage.submitDialog";
}> = [
	{ keys: "⌘K / Ctrl+K", actionKey: "settings.inputPage.expandSearch" },
	{ keys: "Esc", actionKey: "settings.inputPage.closeOverlays" },
	{ keys: "Enter", actionKey: "settings.inputPage.submitDialog" },
];
