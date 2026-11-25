/**
 * 设置页的终端分节。
 *
 * 终端跑在主机的 pty 子进程里，「用哪个 shell」只有主机知道：它探测本机装了哪些（Windows 上
 * 是 pwsh 7 / Windows PowerShell / Git Bash / WSL / cmd，POSIX 上是 `$SHELL`），这里只把清单
 * 摆成一个下拉。选中项存进设置，新建终端时由主机按它解析路径与启动参数。
 *
 * 清单是主机此刻的状态，不是设置的一部分：切走再回来要重取，读不到就在原地说事实并给重试。
 */
import type { FacetSettings, TerminalProfileInfo } from "@facet/protocol";
import { useCallback, useEffect, useState } from "react";
import { Select } from "../common/select.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import type { SettingsDataSource } from "./settings-data-source.ts";
import { SettingsGroup, SettingsRow, StatusNote } from "./settings-layout.tsx";

/** 终端设置分节。 */
export function TerminalSection({
	draft,
	patch,
	data,
}: {
	/** 正在编辑的那份设置 */
	draft: FacetSettings;
	/** 改一处草稿 */
	patch: (change: (current: FacetSettings) => FacetSettings) => void;
	/** 数据来源 */
	data: SettingsDataSource;
}): React.JSX.Element {
	const { t } = useI18n();
	/** 主机上报的可用终端；为空表示还没读到 */
	const [profiles, setProfiles] = useState<readonly TerminalProfileInfo[] | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);

	const loadProfiles = useCallback(async (): Promise<void> => {
		setError(undefined);
		try {
			setProfiles(await data.loadTerminalProfiles());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [data]);

	useEffect(() => {
		if (profiles !== undefined) {
			return;
		}
		void loadProfiles();
	}, [loadProfiles, profiles]);

	// 设置里留着的标识可能已经不在本机（换了主机、卸载了 Git Bash）：那种情况界面仍然显示
	// 「自动」，与主机的回落行为一致
	const known = profiles?.some((profile) => profile.id === draft.terminal.profile) === true;
	const value = known ? draft.terminal.profile : "";

	return (
		<>
			<h2 className="set-section-title">{t("settings.terminalPage.title")}</h2>
			<SettingsGroup label={t("settings.terminalPage.startup")}>
				<SettingsRow title={t("settings.terminalPage.defaultShell")}>
					{profiles === undefined ? (
						<span className="set-hint">{error ?? t("settings.loading")}</span>
					) : (
						<Select
							value={value}
							options={[
								{ value: "", label: t("settings.terminalPage.auto") },
								...profiles.map((profile) => ({ value: profile.id, label: profile.label })),
							]}
							onChange={(next) =>
								patch((current) => ({
									...current,
									terminal: { ...current.terminal, profile: next },
								}))
							}
							ariaLabel={t("settings.terminalPage.defaultShell")}
						/>
					)}
				</SettingsRow>
			</SettingsGroup>
			{error === undefined ? null : (
				<StatusNote
					message={t("settings.terminalPage.readFailed", { error })}
					onRetry={() => void loadProfiles()}
				/>
			)}
		</>
	);
}
