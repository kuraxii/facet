/**
 * 设置页。
 *
 * 左侧分类、右侧内容；切换分类只加载该分类需要的数据，读取与保存都有明确的进行中与失败状态。
 * 保存失败时保留用户正在编辑的输入，可以直接重试。
 */
import type { LanguageSetting } from "@facet/i18n";
import {
	DEFAULT_SETTINGS,
	type FacetSettings,
	type NotificationSettings,
	type ProviderInfo,
	type TerminalLocalSettings,
} from "@facet/protocol";
import { Bot, Cpu, Info, Keyboard, Palette, SlidersHorizontal, Terminal, X } from "lucide-react";
import { type ComponentType, Fragment, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../common/Button.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { ListRow } from "../common/ListRow.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Modal } from "../modal.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ModelsSection } from "./ModelsSection.tsx";
import { AboutSection } from "./settings-about-section.tsx";
import { SettingsAgentsSection } from "./settings-agents-section.tsx";
import { AppearanceSection } from "./settings-appearance-section.tsx";
import type { SettingsDataSource } from "./settings-data-source.ts";
import { GeneralSection } from "./settings-general-section.tsx";
import { InputSection } from "./settings-input-section.tsx";
import { StatusNote } from "./settings-layout.tsx";
import { TerminalLocalSection, TerminalSection } from "./settings-terminal-section.tsx";

/** 设置分类。 */
export type SettingsSection = "general" | "models" | "agents" | "appearance" | "input" | "terminal" | "about";

/** 自动保存的延迟：改动停下后等这么久再提交，连续调整只保存最后一次。 */
const AUTO_SAVE_DELAY_MS = 1000;

/** 分类图标属性：只接收统一规格的尺寸与无障碍隐藏标记。 */
type SectionIcon = ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;

/** 分类顺序、图标与标题文案键。 */
const SECTIONS: ReadonlyArray<{
	key: SettingsSection;
	labelKey:
		| "settings.general"
		| "settings.models"
		| "settings.agents"
		| "settings.appearance"
		| "settings.input"
		| "settings.terminal"
		| "settings.about";
	icon: SectionIcon;
	/** 这一项前是否插一条导航分隔线，把信息类入口与设置分组拉开 */
	dividerBefore?: boolean;
}> = [
	{ key: "general", labelKey: "settings.general", icon: SlidersHorizontal },
	{ key: "models", labelKey: "settings.models", icon: Cpu },
	{ key: "agents", labelKey: "settings.agents", icon: Bot },
	{ key: "appearance", labelKey: "settings.appearance", icon: Palette },
	{ key: "input", labelKey: "settings.input", icon: Keyboard },
	{ key: "terminal", labelKey: "settings.terminal", icon: Terminal },
	{ key: "about", labelKey: "settings.about", icon: Info, dividerBefore: true },
];

/** 设置的读取与保存入口，由宿主接到主机上。 */
export type { SettingsDataSource } from "./settings-data-source.ts";

/** 设置页参数。 */
export interface SettingsPageProps {
	/** 是否处于打开态；退场动画期间可传 false 保持挂载以平滑关闭 */
	open?: boolean | undefined;
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
	/** 本机优先的外观配置；提供后直接本地读写，不受主机权限与切换影响 */
	localAppearance?: FacetSettings["appearance"];
	/** 更新本机外观配置 */
	onLocalAppearanceChange?: (appearance: FacetSettings["appearance"]) => void;
	/** 本机优先的输入配置；提供后直接本地读写，不受主机权限与切换影响 */
	localInput?: FacetSettings["input"];
	/** 更新本机输入配置 */
	onLocalInputChange?: (input: FacetSettings["input"]) => void;
	/** 本机优先的桌面通知配置 */
	localNotifications?: NotificationSettings;
	/** 更新本机桌面通知配置 */
	onLocalNotificationsChange?: (notifications: NotificationSettings) => void;
	/** 本机优先的终端交互配置 */
	localTerminal?: TerminalLocalSettings;
	/** 更新本机终端交互配置 */
	onLocalTerminalChange?: (terminal: TerminalLocalSettings) => void;
	/**
	 * 这条连接能不能改设置。
	 *
	 * 凭证、设置与项目清单由主机限定只在本机操作，远程连接（含 Web 端）能读不能改；
	 * 关掉之后内容照常显示，控件不可用，也不会有自动保存。
	 */
	canEdit?: boolean;
	/** Host 级设置可选的目标主机清单 */
	targetHosts?: readonly { endpoint: string; label: string; isOnline: boolean }[];
	/** 当前正在配置的目标主机端点 */
	selectedHostEndpoint?: string;
	/** 切换目标主机 */
	onSelectTargetHost?: (endpoint: string) => void;
	/** 触发连接指定远程主机 */
	onConnectTargetHost?: (endpoint: string) => void;
}

export function SettingsPage({
	open = true,
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
	localAppearance,
	onLocalAppearanceChange,
	localInput,
	onLocalInputChange,
	localNotifications,
	onLocalNotificationsChange,
	localTerminal,
	onLocalTerminalChange,
	targetHosts,
	selectedHostEndpoint,
	onSelectTargetHost,
	onConnectTargetHost,
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

	const appearanceLocal = localAppearance !== undefined && onLocalAppearanceChange !== undefined;
	const inputLocal = localInput !== undefined && onLocalInputChange !== undefined;
	const isHostScopedSection =
		section === "models" || section === "agents" || (section === "terminal" && !appearanceLocal);
	const activeTargetHost =
		targetHosts?.find((item) => item.endpoint === selectedHostEndpoint) ?? targetHosts?.[0];
	const targetHostOnline = activeTargetHost?.isOnline ?? true;
	const needsHostSettings =
		targetHostOnline &&
		(section === "terminal" ||
			section === "models" ||
			(section === "appearance" && !appearanceLocal) ||
			(section === "input" && !inputLocal));

	// 切换目标主机（`data` 引用改变）时清空已缓存的主机配置，重新向对应节点读取
	useEffect(() => {
		void data;
		setSettings(undefined);
		setDraft(undefined);
		setProviders(undefined);
		setLoadError(undefined);
		setProvidersError(undefined);
	}, [data]);

	// 只有依赖主机设置的分节才需要从服务端加载
	useEffect(() => {
		if (!needsHostSettings || settings !== undefined) {
			return;
		}
		void loadSettings();
	}, [loadSettings, needsHostSettings, settings]);

	// 提供方现在挂在模型页里
	useEffect(() => {
		if (!targetHostOnline || section !== "models" || providers !== undefined) {
			return;
		}
		void loadProviders();
	}, [loadProviders, providers, section, targetHostOnline]);

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
	const flushPending = useCallback(() => {
		const pending = pendingRef.current;
		if (pending !== undefined) {
			pendingRef.current = undefined;
			void saveRef.current(pending).catch(() => undefined);
		}
	}, []);
	useEffect(() => {
		if (!open) {
			flushPending();
		}
	}, [open, flushPending]);
	useEffect(() => flushPending, [flushPending]);

	const activeLabelKey = SECTIONS.find((item) => item.key === section)?.labelKey ?? "settings.models";

	return (
		<Modal open={open} onClose={onClose} label={t("settings.title")} className="set-page">
			<aside className="set-sidebar">
				<div className="set-sidebar-head">
					<h1 className="set-title">{t("settings.title")}</h1>
				</div>
				<nav className="set-nav" aria-label={t("settings.categories")}>
					{SECTIONS.map((item) => {
						const Icon = item.icon;
						return (
							<Fragment key={item.key}>
								{item.dividerBefore ? <div className="set-nav-divider" aria-hidden="true" /> : null}
								<ListRow
									as="button"
									size="md"
									selected={item.key === section}
									className="set-nav-item"
									aria-current={item.key === section}
									onClick={() => onSectionChange(item.key)}
								>
									<Icon size={ICON_SIZE.lg} className="set-nav-icon" aria-hidden />
									<span className="set-nav-label ell">{t(item.labelKey)}</span>
								</ListRow>
							</Fragment>
						);
					})}
				</nav>
			</aside>

			<div className="set-main">
				<header className="set-main-head">
					<h2 className="set-main-title">{t(activeLabelKey)}</h2>
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

				<div className="set-content">
					{isHostScopedSection &&
					targetHosts !== undefined &&
					targetHosts.length > 0 &&
					onSelectTargetHost !== undefined ? (
						<div className="set-host-bar">
							<span className="set-host-label">{t("settings.targetHost")}</span>
							<div className="set-host-pills" role="tablist" aria-label={t("settings.targetHost")}>
								{targetHosts.map((item) => {
									const isSelected = item.endpoint === (selectedHostEndpoint ?? activeTargetHost?.endpoint);
									return (
										<button
											type="button"
											role="tab"
											aria-selected={isSelected}
											key={item.endpoint}
											className={isSelected ? "set-host-pill is-on" : "set-host-pill"}
											onClick={() => onSelectTargetHost(item.endpoint)}
										>
											<span className={item.isOnline ? "host-dot is-ready" : "host-dot"} aria-hidden="true" />
											<span>{item.label}</span>
										</button>
									);
								})}
							</div>
						</div>
					) : null}

					{section === "general" ? (
						<GeneralSection
							uiScale={uiScale}
							onUiScaleChange={onUiScaleChange}
							languageSetting={languageSetting}
							onLanguageChange={onLanguageChange}
							localNotifications={localNotifications}
							onLocalNotificationsChange={onLocalNotificationsChange}
						/>
					) : null}

					{section === "appearance" && appearanceLocal ? (
						<section className="set-section">
							<AppearanceSection
								draft={{ ...DEFAULT_SETTINGS, appearance: localAppearance }}
								patch={(change) => {
									const next = change({ ...DEFAULT_SETTINGS, appearance: localAppearance });
									onLocalAppearanceChange(next.appearance);
								}}
								onPreview={onAppearancePreview}
							/>
						</section>
					) : null}

					{section === "input" && inputLocal ? (
						<section className="set-section">
							<InputSection
								draft={{ ...DEFAULT_SETTINGS, input: localInput }}
								patch={(change) => {
									const next = change({ ...DEFAULT_SETTINGS, input: localInput });
									onLocalInputChange(next.input);
								}}
							/>
						</section>
					) : null}

					{section === "terminal" && localTerminal !== undefined && onLocalTerminalChange !== undefined ? (
						<section className="set-section">
							<TerminalLocalSection terminal={localTerminal} onChange={onLocalTerminalChange} />
						</section>
					) : null}

					{section === "agents" ? (
						targetHostOnline ? (
							<fieldset className="set-lock" disabled={!canEdit}>
								<section className="set-section">
									<SettingsAgentsSection data={data} />
								</section>
							</fieldset>
						) : activeTargetHost !== undefined && onConnectTargetHost !== undefined ? (
							<div className="set-host-offline">
								<Button variant="primary" onClick={() => onConnectTargetHost(activeTargetHost.endpoint)}>
									{`${t("host.connect")} · ${activeTargetHost.label}`}
								</Button>
							</div>
						) : null
					) : null}

					{section === "about" ? <AboutSection about={about} data={data} /> : null}

					{section === "models" &&
					!targetHostOnline &&
					activeTargetHost !== undefined &&
					onConnectTargetHost !== undefined ? (
						<div className="set-host-offline">
							<Button variant="primary" onClick={() => onConnectTargetHost(activeTargetHost.endpoint)}>
								{`${t("host.connect")} · ${activeTargetHost.label}`}
							</Button>
						</div>
					) : null}

					{needsHostSettings ? (
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
										{section === "appearance" && !appearanceLocal ? (
											<AppearanceSection draft={draft} patch={patch} onPreview={onAppearancePreview} />
										) : null}
										{section === "input" && !inputLocal ? <InputSection draft={draft} patch={patch} /> : null}
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
