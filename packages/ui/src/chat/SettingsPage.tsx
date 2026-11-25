/**
 * 设置页。
 *
 * 左侧分类、右侧内容；切换分类只加载该分类需要的数据，读取与保存都有明确的进行中与失败状态。
 * 保存失败时保留用户正在编辑的输入，可以直接重试。
 */
import type { LanguageSetting } from "@facet/i18n";
import type { FacetSettings, ProviderInfo } from "@facet/protocol";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "../common/IconButton.tsx";
import { ListRow } from "../common/ListRow.tsx";
import { Select } from "../common/select.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Modal } from "../modal.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ModelsSection } from "./ModelsSection.tsx";
import { AboutSection } from "./settings-about-section.tsx";
import { AppearanceSection } from "./settings-appearance-section.tsx";
import type { SettingsDataSource } from "./settings-data-source.ts";
import { InputSection } from "./settings-input-section.tsx";
import { SettingsGroup, SettingsRow, StatusNote } from "./settings-layout.tsx";
import { TerminalSection } from "./settings-terminal-section.tsx";
import { UI_SCALE_STEPS } from "./ui-scale.ts";

/** 设置分类。 */
export type SettingsSection = "models" | "appearance" | "input" | "terminal" | "about";

/** 自动保存的延迟：改动停下后等这么久再提交，连续调整只保存最后一次。 */
const AUTO_SAVE_DELAY_MS = 1000;

/** 分类顺序与标题文案键。 */
const SECTIONS: ReadonlyArray<{
	key: SettingsSection;
	labelKey:
		| "settings.models"
		| "settings.appearance"
		| "settings.input"
		| "settings.terminal"
		| "settings.about";
}> = [
	{ key: "models", labelKey: "settings.models" },
	{ key: "appearance", labelKey: "settings.appearance" },
	{ key: "input", labelKey: "settings.input" },
	{ key: "terminal", labelKey: "settings.terminal" },
	{ key: "about", labelKey: "settings.about" },
];

/** 设置的读取与保存入口，由宿主接到主机上。 */
export type { SettingsDataSource } from "./settings-data-source.ts";

/** 设置页参数。 */
export interface SettingsPageProps {
	/** 当前分类 */
	section: SettingsSection;
	/** 切换分类 */
	onSectionChange: (section: SettingsSection) => void;
	/** 关闭设置回到对话 */
	onClose: () => void;
	/** 数据来源 */
	data: SettingsDataSource;
	/** 设置保存成功后通知宿主应用 */
	onSettingsApplied?: (settings: FacetSettings) => void;
	/** 外观改动时先带给宿主预览，保存之前不落盘 */
	onAppearancePreview?: (appearance: FacetSettings["appearance"]) => void;
	/** 应用版本等只读信息 */
	about: { appVersion: string; runtime: string; endpoint: string };
	/** 本机界面缩放百分比；不传时不显示这一项 */
	uiScale?: number;
	/** 修改本机界面缩放 */
	onUiScaleChange?: (scale: number) => void;
	/** 本机语言设置；不传时不显示语言项 */
	languageSetting?: LanguageSetting;
	/** 修改本机语言 */
	onLanguageChange?: (setting: LanguageSetting) => void;
	/**
	 * 这条连接能不能改设置。
	 *
	 * 凭证、设置与项目清单由主机限定只在本机操作，远程连接（含 Web 端）能读不能改；
	 * 关掉之后内容照常显示，控件不可用，也不会有自动保存。
	 */
	canEdit?: boolean;
}

export function SettingsPage({
	section,
	onSectionChange,
	onClose,
	data,
	onSettingsApplied,
	onAppearancePreview,
	about,
	canEdit = true,
	uiScale,
	onUiScaleChange,
	languageSetting,
	onLanguageChange,
}: SettingsPageProps) {
	const { t } = useI18n();
	/** 已加载的设置；为空表示还没读到 */
	const [settings, setSettings] = useState<FacetSettings | undefined>(undefined);
	/** 正在编辑的那份；保存成功前不回写 settings */
	const [draft, setDraft] = useState<FacetSettings | undefined>(undefined);
	const [isLoading, setIsLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | undefined>(undefined);
	const [saveError, setSaveError] = useState<string | undefined>(undefined);
	const [providers, setProviders] = useState<readonly ProviderInfo[] | undefined>(undefined);
	const [providersError, setProvidersError] = useState<string | undefined>(undefined);

	const loadSettings = useCallback(async () => {
		setIsLoading(true);
		setLoadError(undefined);
		try {
			const loaded = await data.loadSettings();
			setSettings(loaded);
			setDraft(loaded);
		} catch (error) {
			setLoadError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsLoading(false);
		}
	}, [data]);

	const loadProviders = useCallback(async () => {
		setProvidersError(undefined);
		try {
			setProviders(await data.loadProviders());
		} catch (error) {
			setProvidersError(error instanceof Error ? error.message : String(error));
		}
	}, [data]);

	// 模型、外观、输入三个分类共用同一份设置，进入时读一次
	useEffect(() => {
		if (section === "about") {
			return;
		}
		if (settings !== undefined) {
			return;
		}
		void loadSettings();
	}, [loadSettings, section, settings]);

	// 提供方现在挂在模型页里
	useEffect(() => {
		if (section !== "models" || providers !== undefined) {
			return;
		}
		void loadProviders();
	}, [loadProviders, providers, section]);

	/** 改一处草稿。 */
	const patch = (change: (current: FacetSettings) => FacetSettings): void => {
		setDraft((current) => (current === undefined ? current : change(current)));
		setSaveError(undefined);
	};

	const save = useCallback(
		async (next: FacetSettings): Promise<void> => {
			setSaveError(undefined);
			try {
				const saved = await data.saveSettings(next);
				setSettings(saved);
				// 提交期间又改过就保留新的草稿，下一次自动保存会把两处改动一起提交
				setDraft((current) =>
					current !== undefined && JSON.stringify(current) !== JSON.stringify(next) ? current : saved,
				);
				onSettingsApplied?.(saved);
			} catch (error) {
				setSaveError(error instanceof Error ? error.message : String(error));
			}
		},
		[data, onSettingsApplied],
	);

	const isDirty =
		settings !== undefined && draft !== undefined && JSON.stringify(settings) !== JSON.stringify(draft);

	/** 保存函数每次渲染都是新的，定时器只按草稿与脏标记重置，避免父组件重绘把等待时间一直推后 */
	const saveRef = useRef(save);
	saveRef.current = save;

	// 草稿变化后延迟提交，一秒内继续改就重新计时
	useEffect(() => {
		if (!isDirty || draft === undefined) {
			return;
		}
		const timer = setTimeout(() => {
			void saveRef.current(draft);
		}, AUTO_SAVE_DELAY_MS);
		return () => {
			clearTimeout(timer);
		};
	}, [draft, isDirty]);

	// 关闭设置时还在等定时器的改动立刻提交，不让最后一秒的编辑丢掉
	const pendingRef = useRef<FacetSettings | undefined>(undefined);
	pendingRef.current = isDirty ? draft : undefined;
	useEffect(
		() => () => {
			const pending = pendingRef.current;
			if (pending !== undefined) {
				void saveRef.current(pending).catch(() => undefined);
			}
		},
		[],
	);

	return (
		<Modal open onClose={onClose} label={t("settings.title")} className="set-page">
			<header className="set-head">
				<h1 className="set-title">{t("settings.title")}</h1>
				<IconButton
					variant="ghost"
					size="sm"
					className="set-close"
					aria-label={t("settings.close")}
					onClick={onClose}
				>
					<X size={ICON_SIZE.lg} />
				</IconButton>
			</header>

			<div className="set-body">
				<nav className="set-nav" aria-label={t("settings.categories")}>
					{SECTIONS.map((item) => (
						<ListRow
							as="button"
							key={item.key}
							selected={item.key === section}
							className="set-nav-item"
							aria-current={item.key === section}
							onClick={() => onSectionChange(item.key)}
						>
							{t(item.labelKey)}
						</ListRow>
					))}
				</nav>

				<div className="set-content">
					{section === "appearance" &&
					((uiScale !== undefined && onUiScaleChange !== undefined) ||
						(languageSetting !== undefined && onLanguageChange !== undefined)) ? (
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

					{section === "about" ? <AboutSection about={about} data={data} /> : null}

					{section === "models" ||
					section === "appearance" ||
					section === "input" ||
					section === "terminal" ? (
						<fieldset className="set-lock" disabled={!canEdit}>
							<section className="set-section">
								{loadError === undefined ? null : (
									<StatusNote
										message={t("settings.readFailed", { error: loadError })}
										onRetry={loadSettings}
									/>
								)}
								{isLoading ? <p className="set-hint">{t("settings.loading")}</p> : null}
								{draft === undefined ? null : (
									<>
										{section === "models" ? (
											<ModelsSection
												data={data}
												providers={providers}
												providersError={providersError}
												onReloadProviders={() => void loadProviders()}
											/>
										) : null}
										{section === "appearance" ? (
											<AppearanceSection draft={draft} patch={patch} onPreview={onAppearancePreview} />
										) : null}
										{section === "input" ? <InputSection draft={draft} patch={patch} /> : null}
										{section === "terminal" ? (
											<TerminalSection draft={draft} patch={patch} data={data} />
										) : null}
										{saveError === undefined ? null : (
											<StatusNote
												message={t("settings.saveFailed", { error: saveError })}
												onRetry={() => void save(draft)}
											/>
										)}
									</>
								)}
							</section>
						</fieldset>
					) : null}
				</div>
			</div>
		</Modal>
	);
}
