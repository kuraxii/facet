/**
 * 设置页的通用分节。
 *
 * 承载纯本机生效的通用偏好：界面语言、界面缩放与桌面通知过滤，不依赖主机连接与管理权限。
 */
import type { LanguageSetting } from "@facet/i18n";
import type { NotificationSettings } from "@facet/protocol";
import { Select } from "../common/select.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { SettingsGroup, SettingsRow } from "./settings-layout.tsx";
import { UI_SCALE_STEPS } from "./ui-scale.ts";

/** 通用设置分节参数。 */
export interface GeneralSectionProps {
	/** 本机界面缩放百分比；不传时不显示这一项 */
	uiScale?: number | undefined;
	/** 修改本机界面缩放 */
	onUiScaleChange?: ((scale: number) => void) | undefined;
	/** 本机语言设置；不传时不显示语言项 */
	languageSetting?: LanguageSetting | undefined;
	/** 修改本机语言 */
	onLanguageChange?: ((setting: LanguageSetting) => void) | undefined;
	/** 本机桌面通知设置；不传时不显示通知分组 */
	localNotifications?: NotificationSettings | undefined;
	/** 修改本机桌面通知设置 */
	onLocalNotificationsChange?: ((next: NotificationSettings) => void) | undefined;
}

/** 通用设置。 */
export function GeneralSection({
	uiScale,
	onUiScaleChange,
	languageSetting,
	onLanguageChange,
	localNotifications,
	onLocalNotificationsChange,
}: GeneralSectionProps): React.JSX.Element {
	const { t } = useI18n();
	const hasLocalGroup =
		(languageSetting !== undefined && onLanguageChange !== undefined) ||
		(uiScale !== undefined && onUiScaleChange !== undefined);
	const hasNotificationGroup = localNotifications !== undefined && onLocalNotificationsChange !== undefined;

	return (
		<>
			{hasLocalGroup ? (
				<section className="set-section">
					<SettingsGroup label={t("settings.local")}>
						{languageSetting === undefined || onLanguageChange === undefined ? null : (
							<SettingsRow title={t("settings.language")}>
								<Select
									value={languageSetting}
									options={[
										{ value: "auto", label: t("language.system") },
										{ value: "en", label: t("language.en") },
										{ value: "zh-CN", label: t("language.zh-CN") },
									]}
									onChange={(value) => onLanguageChange(value as LanguageSetting)}
									ariaLabel={t("settings.language")}
								/>
							</SettingsRow>
						)}
						{uiScale === undefined || onUiScaleChange === undefined ? null : (
							<SettingsRow title={t("settings.uiScale")}>
								<Select
									value={String(uiScale)}
									options={UI_SCALE_STEPS.map((step) => ({ value: String(step), label: `${step}%` }))}
									onChange={(value) => onUiScaleChange(Number(value))}
									ariaLabel={t("settings.uiScale")}
								/>
							</SettingsRow>
						)}
					</SettingsGroup>
				</section>
			) : null}

			{hasNotificationGroup ? (
				<section className="set-section">
					<SettingsGroup label={t("settings.generalPage.notifications")}>
						<SettingsRow title={t("settings.generalPage.notifyEnabled")}>
							<input
								type="checkbox"
								role="switch"
								aria-checked={localNotifications.enabled}
								className="set-switch"
								checked={localNotifications.enabled}
								onChange={(event) =>
									onLocalNotificationsChange({ ...localNotifications, enabled: event.target.checked })
								}
								aria-label={t("settings.generalPage.notifyEnabled")}
							/>
						</SettingsRow>
						<SettingsRow title={t("settings.generalPage.notifySettled")}>
							<input
								type="checkbox"
								role="switch"
								aria-checked={localNotifications.onSettled}
								className="set-switch"
								disabled={!localNotifications.enabled}
								checked={localNotifications.onSettled}
								onChange={(event) =>
									onLocalNotificationsChange({ ...localNotifications, onSettled: event.target.checked })
								}
								aria-label={t("settings.generalPage.notifySettled")}
							/>
						</SettingsRow>
						<SettingsRow title={t("settings.generalPage.notifyNeedsInput")}>
							<input
								type="checkbox"
								role="switch"
								aria-checked={localNotifications.onNeedsInput}
								className="set-switch"
								disabled={!localNotifications.enabled}
								checked={localNotifications.onNeedsInput}
								onChange={(event) =>
									onLocalNotificationsChange({ ...localNotifications, onNeedsInput: event.target.checked })
								}
								aria-label={t("settings.generalPage.notifyNeedsInput")}
							/>
						</SettingsRow>
					</SettingsGroup>
				</section>
			) : null}
		</>
	);
}
