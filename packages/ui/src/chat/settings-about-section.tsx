/**
 * 设置页的关于与诊断分节。
 *
 * 诊断文本由主机生成，凭证与令牌不在其中；导出走宿主的保存对话框，用户自己挑位置。
 */
import { useState } from "react";
import { Button } from "../common/Button.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import type { SettingsDataSource } from "./settings-data-source.ts";

export function AboutSection({
	about,
	data,
}: {
	/** 只读的版本与地址信息 */
	about: { appVersion: string; runtime: string; endpoint: string };
	/** 数据来源 */
	data: SettingsDataSource;
}) {
	const { t } = useI18n();
	const [isExporting, setIsExporting] = useState(false);
	const [result, setResult] = useState<{ tone: "ok" | "error"; message: string } | undefined>(undefined);

	const exportDiagnostics = async () => {
		setIsExporting(true);
		setResult(undefined);
		try {
			const text = await data.diagnostics();
			const saved = await data.saveText(
				`facet-diagnostic-${new Date().toISOString().slice(0, 19)}.json`,
				text,
			);
			setResult(
				saved
					? { tone: "ok", message: t("settings.aboutPage.exported") }
					: { tone: "ok", message: t("settings.aboutPage.cancelled") },
			);
		} catch (error) {
			setResult({ tone: "error", message: error instanceof Error ? error.message : String(error) });
		} finally {
			setIsExporting(false);
		}
	};

	return (
		<section className="set-section">
			<ul className="set-list">
				<li className="set-row">
					<span className="set-row-name">{t("settings.aboutPage.appVersion")}</span>
					<span className="set-row-meta mono selectable">{about.appVersion}</span>
				</li>
				<li className="set-row">
					<span className="set-row-name">{t("settings.aboutPage.runtime")}</span>
					<span className="set-row-meta mono selectable">{about.runtime}</span>
				</li>
				<li className="set-row">
					<span className="set-row-name">{t("settings.aboutPage.endpoint")}</span>
					<span className="set-row-meta mono selectable">{about.endpoint}</span>
				</li>
			</ul>
			<div className="set-actions">
				<Button variant="primary" size="md" disabled={isExporting} onClick={() => void exportDiagnostics()}>
					{isExporting ? t("settings.aboutPage.exporting") : t("settings.aboutPage.export")}
				</Button>
			</div>
			{result === undefined ? null : (
				<p className={result.tone === "error" ? "set-row-error" : "set-hint"}>{result.message}</p>
			)}
		</section>
	);
}
