/**
 * 设置页。
 *
 * 左侧分类、右侧内容；切换分类只加载该分类需要的数据，读取与保存都有明确的进行中与失败状态。
 * 保存失败时保留用户正在编辑的输入，可以直接重试。
 */
import type { CustomProviderInfo, FacetSettings, ModelInfo, ModelRef, ProviderInfo } from "@facet/protocol";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { CODE_THEME_OPTIONS, UI_THEME_OPTIONS } from "../theme.ts";
import { ProvidersSection } from "./ProvidersSection.tsx";
import { providerRows } from "./provider-rows.ts";
import type { SettingsDataSource } from "./settings-data-source.ts";
import { SettingsGroup, SettingsRow } from "./settings-layout.tsx";

/** 设置分类。 */
export type SettingsSection = "models" | "appearance" | "input" | "about";

/** 自动保存的延迟：改动停下后等这么久再提交，连续调整只保存最后一次。 */
const AUTO_SAVE_DELAY_MS = 1000;

/** 分类顺序与标题。 */
const SECTIONS: ReadonlyArray<{ key: SettingsSection; label: string }> = [
	{ key: "models", label: "模型" },
	{ key: "appearance", label: "外观" },
	{ key: "input", label: "输入" },
	{ key: "about", label: "关于" },
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
	/**
	 * 这条连接能不能改设置。
	 *
	 * 凭证、设置与项目清单由主机限定只在本机操作，远程连接（含 Web 端）能读不能改；
	 * 关掉之后内容照常显示，控件不可用，也不会有自动保存。
	 */
	canEdit?: boolean;
}

/** 一段加载或保存失败的信息，带重试。 */
function StatusNote({
	message,
	onRetry,
	tone,
}: {
	message: string;
	onRetry: () => void;
	tone: "error" | "pending";
}) {
	return (
		<div className={tone === "error" ? "set-note is-error" : "set-note"}>
			<span>{message}</span>
			<button type="button" className="set-note-action" onClick={onRetry}>
				重试
			</button>
		</div>
	);
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
}: SettingsPageProps) {
	/** 已加载的设置；为空表示还没读到 */
	const [settings, setSettings] = useState<FacetSettings | undefined>(undefined);
	/** 正在编辑的那份；保存成功前不回写 settings */
	const [draft, setDraft] = useState<FacetSettings | undefined>(undefined);
	const [isLoading, setIsLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | undefined>(undefined);
	const [saveError, setSaveError] = useState<string | undefined>(undefined);
	const [providers, setProviders] = useState<readonly ProviderInfo[] | undefined>(undefined);
	const [providersError, setProvidersError] = useState<string | undefined>(undefined);

	/** 关闭回调每次渲染都是新的，事件监听只挂一次，用 ref 转一手 */
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	/** 设置窗口本身，打开时把焦点交给它 */
	const windowRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const previous = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
		windowRef.current?.focus();
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key === "Escape") {
				onCloseRef.current();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			// 关闭后焦点回到打开设置的那个按钮。放到下一轮事件循环里给：这一轮里窗口还在
			// 移除中，而且点遮罩的 click 随后还会把焦点带回 body
			if (previous !== undefined) {
				setTimeout(() => previous.focus(), 0);
			}
		};
	}, []);

	/** 点窗口外面关闭。 */
	const handleBackdropPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
		const window = windowRef.current;
		if (window !== null && event.target instanceof Node && window.contains(event.target)) {
			return;
		}
		onClose();
	};

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
		<div className="dialog-backdrop" role="presentation" onPointerDown={handleBackdropPointerDown}>
			<div
				ref={windowRef}
				className="set-page"
				role="dialog"
				aria-modal="true"
				aria-label="设置"
				tabIndex={-1}
			>
				<header className="set-head">
					<h1 className="set-title">设置</h1>
					<button type="button" className="set-close" aria-label="关闭设置" onClick={onClose}>
						<X size={16} strokeWidth={1.5} />
					</button>
				</header>

				<div className="set-body">
					<nav className="set-nav" aria-label="设置分类">
						{SECTIONS.map((item) => (
							<button
								type="button"
								key={item.key}
								className={item.key === section ? "set-nav-item is-on" : "set-nav-item"}
								aria-current={item.key === section}
								onClick={() => onSectionChange(item.key)}
							>
								{item.label}
							</button>
						))}
					</nav>

					<div className="set-content">
						{section === "about" ? <AboutSection about={about} data={data} /> : null}

						{section === "models" || section === "appearance" || section === "input" ? (
							<fieldset className="set-lock" disabled={!canEdit}>
								<section className="set-section">
									{loadError === undefined ? null : (
										<StatusNote message={`读取设置失败:${loadError}`} onRetry={loadSettings} tone="error" />
									)}
									{isLoading ? <p className="set-hint">正在读取设置…</p> : null}
									{draft === undefined ? null : (
										<>
											{section === "models" ? (
												<ModelsSection
													draft={draft}
													patch={patch}
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
											{saveError === undefined ? null : (
												<StatusNote
													message={`保存失败:${saveError}`}
													onRetry={() => void save(draft)}
													tone="error"
												/>
											)}
										</>
									)}
								</section>
							</fieldset>
						) : null}
					</div>
				</div>
			</div>
		</div>
	);
}

/** 模型键，模型可见性与选择器共用。 */
function modelKey(model: ModelRef): string {
	return `${model.provider}/${model.id}`;
}

/**
 * 模型设置。
 *
 * 一页里放三件事：新建会话采用的默认模型与思考档位、已配置的提供方（含凭证与地址）、可用模型的
 * 连通性测试。档位按所选模型是否支持思考来筛，不支持时只留「不思考」。
 */
function ModelsSection({
	draft,
	patch,
	data,
	providers,
	providersError,
	onReloadProviders,
}: {
	draft: FacetSettings;
	patch: (change: (current: FacetSettings) => FacetSettings) => void;
	data: SettingsDataSource;
	providers: readonly ProviderInfo[] | undefined;
	providersError: string | undefined;
	onReloadProviders: () => void;
}) {
	const [models, setModels] = useState<readonly ModelInfo[] | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	/** 每个模型的测试结果，键为 provider/model */
	const [tests, setTests] = useState<
		Record<string, { ok: boolean; latencyMs: number; message?: string } | undefined>
	>({});
	/** 正在测试的模型 */
	const [testing, setTesting] = useState<string | undefined>(undefined);
	/** 自定义提供方的完整配置，提供方列表与模型筛选用同一份 */
	const [customs, setCustoms] = useState<readonly CustomProviderInfo[] | undefined>(undefined);

	/** 发一次最小请求，结果留在该模型下面。 */
	const runTest = async (model: ModelInfo) => {
		const key = modelKey(model);
		setTesting(key);
		try {
			const result = await data.testModel({ provider: model.provider, id: model.id });
			setTests((current) => ({ ...current, [key]: result }));
		} catch (testError) {
			setTests((current) => ({
				...current,
				[key]: {
					ok: false,
					latencyMs: 0,
					message: testError instanceof Error ? testError.message : String(testError),
				},
			}));
		} finally {
			setTesting(undefined);
		}
	};

	const load = useCallback(async () => {
		setError(undefined);
		try {
			setModels(await data.loadModels());
		} catch (loadError) {
			setError(loadError instanceof Error ? loadError.message : String(loadError));
		}
	}, [data]);

	useEffect(() => {
		if (models !== undefined) {
			return;
		}
		void load();
	}, [load, models]);

	useEffect(() => {
		if (customs !== undefined) {
			return;
		}
		void data
			.listCustomProviders()
			.then(setCustoms)
			.catch(() => setCustoms([]));
	}, [customs, data]);

	if (error !== undefined) {
		return (
			<>
				<h2 className="set-section-title">模型</h2>
				<StatusNote message={`读取模型失败:${error}`} onRetry={() => void load()} tone="error" />
			</>
		);
	}
	if (models === undefined) {
		return (
			<>
				<h2 className="set-section-title">模型</h2>
				<p className="set-hint">正在读取模型…</p>
			</>
		);
	}

	// 只列已配置提供方的模型：没配置凭证的提供方用不了，列出来只是噪声。两者都读到之前先不筛
	const usable =
		providers === undefined || customs === undefined
			? models
			: (() => {
					const configured = new Set(
						providerRows(providers, customs)
							.filter(({ provider, custom }) => provider.authenticated || custom !== undefined)
							.map(({ provider }) => provider.id),
					);
					return models.filter((model) => configured.has(model.provider));
				})();

	const selected = draft.defaultModel;
	// 选中的模型不支持思考时,只保留「不思考」一档
	const selectedModel =
		selected === undefined ? undefined : models.find((model) => modelKey(model) === modelKey(selected));
	const levelOptions =
		selectedModel === undefined || selectedModel.reasoning ? THINKING_LEVEL_OPTIONS : (["off"] as const);

	return (
		<>
			<h2 className="set-section-title">模型</h2>
			<SettingsGroup label="默认设置">
				<SettingsRow title="默认模型">
					<select
						className="set-input"
						value={selected === undefined ? "" : modelKey(selected)}
						onChange={(event) => {
							const value = event.target.value;
							const found = models.find((model) => modelKey(model) === value);
							patch((current) => ({
								...current,
								defaultModel: found === undefined ? undefined : { provider: found.provider, id: found.id },
							}));
						}}
						aria-label="默认模型"
					>
						<option value="">由主机决定</option>
						{usable.map((model) => (
							<option key={modelKey(model)} value={modelKey(model)}>
								{model.provider} / {model.name}
							</option>
						))}
					</select>
				</SettingsRow>
				<SettingsRow title="默认思考档位">
					<select
						className="set-input"
						value={draft.defaultThinkingLevel ?? ""}
						onChange={(event) => {
							const value = event.target.value;
							patch((current) => ({
								...current,
								...(value.length === 0
									? { defaultThinkingLevel: undefined }
									: { defaultThinkingLevel: value as ThinkingLevelValue }),
							}));
						}}
						aria-label="默认思考档位"
					>
						<option value="">由模型决定</option>
						{levelOptions.map((level) => (
							<option key={level} value={level}>
								{level}
							</option>
						))}
					</select>
				</SettingsRow>
			</SettingsGroup>

			<ProvidersSection
				providers={providers}
				error={providersError}
				// 凭证变了，可用模型的范围也跟着变
				onReload={() => {
					onReloadProviders();
					void load();
				}}
				data={data}
				customs={customs}
				onCustomsChange={setCustoms}
			/>

			<h3 className="set-group-title set-group-title-lg">可用模型</h3>
			<ul className="set-list set-list-scroll">
				{usable.map((model) => {
					const key = modelKey(model);
					const probe = tests[key];
					return (
						<li key={key} className="set-row is-block">
							<div className="set-row-head">
								<span className="set-row-name ell">
									{model.provider} / {model.name}
								</span>
								{probe === undefined ? null : (
									<span className={probe.ok ? "set-badge is-on" : "set-badge is-off"}>
										{probe.ok ? `可用 · ${probe.latencyMs} ms` : "不可用"}
									</span>
								)}
								<button
									type="button"
									className="set-row-action"
									disabled={testing === key}
									onClick={() => void runTest(model)}
								>
									{testing === key ? "测试中…" : "测试"}
								</button>
							</div>
							{probe?.message === undefined ? null : <p className="set-row-error">{probe.message}</p>}
						</li>
					);
				})}
				{usable.length === 0 ? <li className="set-row set-row-empty">还没有可用的模型</li> : null}
			</ul>
		</>
	);
}

/** 思考档位的取值，与协议里的 ThinkingLevel 一致。 */
const THINKING_LEVEL_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevelValue = (typeof THINKING_LEVEL_OPTIONS)[number];

/** 外观设置。 */
function AppearanceSection({
	draft,
	patch,
	onPreview,
}: {
	draft: FacetSettings;
	patch: (change: (current: FacetSettings) => FacetSettings) => void;
	onPreview: ((appearance: FacetSettings["appearance"]) => void) | undefined;
}) {
	const appearance = draft.appearance;
	// 外观改动立刻作用到界面上，关掉设置页而不保存时由宿主恢复
	const patchAppearance = (change: Partial<FacetSettings["appearance"]>): void => {
		const next = { ...appearance, ...change };
		patch((current) => ({ ...current, appearance: next }));
		onPreview?.(next);
	};
	/** 字号输入的公共写法：留空或越界时保持原值。 */
	const sizeInput = (value: number, name: keyof FacetSettings["appearance"]): React.JSX.Element => (
		<input
			className="set-input is-number mono"
			type="number"
			min={11}
			max={20}
			value={value}
			onChange={(event) => {
				const next = Number(event.target.value);
				if (Number.isFinite(next)) {
					patchAppearance({ [name]: next } as Partial<FacetSettings["appearance"]>);
				}
			}}
			aria-label={String(name)}
		/>
	);

	return (
		<>
			<h2 className="set-section-title">外观</h2>
			<SettingsGroup label="通用">
				<SettingsRow title="主题" isStacked>
					<div className="set-swatches">
						{UI_THEME_OPTIONS.map((option) => (
							<button
								key={option.id}
								type="button"
								className={appearance.theme === option.id ? "set-swatch is-active" : "set-swatch"}
								title={option.label}
								aria-label={option.label}
								aria-pressed={appearance.theme === option.id}
								onClick={() => patchAppearance({ theme: option.id })}
							>
								<i className="set-swatch-chip" style={{ background: option.swatch }} />
								<span className="set-swatch-name">{option.label}</span>
							</button>
						))}
						<button
							type="button"
							className={appearance.theme === "system" ? "set-swatch is-active" : "set-swatch"}
							title="跟随系统"
							aria-label="跟随系统"
							aria-pressed={appearance.theme === "system"}
							onClick={() => patchAppearance({ theme: "system" })}
						>
							<i className="set-swatch-chip is-system" />
							<span className="set-swatch-name">跟随系统</span>
						</button>
					</div>
				</SettingsRow>
				<SettingsRow title="减少动效">
					<input
						type="checkbox"
						checked={appearance.reducedMotion}
						onChange={(event) => patchAppearance({ reducedMotion: event.target.checked })}
						aria-label="减少动效"
					/>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="字体">
				<SettingsRow title="界面字体">
					<input
						className="set-input"
						value={appearance.uiFont}
						onChange={(event) => patchAppearance({ uiFont: event.target.value })}
						placeholder="Inter"
						aria-label="界面字体"
					/>
				</SettingsRow>
				<SettingsRow title="界面字号">{sizeInput(appearance.uiFontSize, "uiFontSize")}</SettingsRow>
				<SettingsRow title="代码字体">
					<input
						className="set-input"
						value={appearance.codeFont}
						onChange={(event) => patchAppearance({ codeFont: event.target.value })}
						placeholder="Maple Mono"
						aria-label="代码字体"
					/>
				</SettingsRow>
				<SettingsRow title="编辑器字体">
					<input
						className="set-input"
						value={appearance.editorFont}
						onChange={(event) => patchAppearance({ editorFont: event.target.value })}
						placeholder="跟代码字体"
						aria-label="编辑器字体"
					/>
				</SettingsRow>
				<SettingsRow title="编辑器字号">{sizeInput(appearance.editorFontSize, "editorFontSize")}</SettingsRow>
				<SettingsRow title="终端字体">
					<input
						className="set-input"
						value={appearance.terminalFont}
						onChange={(event) => patchAppearance({ terminalFont: event.target.value })}
						placeholder="跟代码字体"
						aria-label="终端字体"
					/>
				</SettingsRow>
				<SettingsRow title="终端字号">
					{sizeInput(appearance.terminalFontSize, "terminalFontSize")}
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="代码配色">
				<SettingsRow title="代码配色">
					<select
						className="set-input"
						value={appearance.codeTheme}
						onChange={(event) =>
							patchAppearance({
								codeTheme: event.target.value as FacetSettings["appearance"]["codeTheme"],
							})
						}
						aria-label="代码配色"
					>
						{CODE_THEME_OPTIONS.map((option) => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</select>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

/** 输入设置。 */
function InputSection({
	draft,
	patch,
}: {
	draft: FacetSettings;
	patch: (change: (current: FacetSettings) => FacetSettings) => void;
}) {
	return (
		<>
			<h2 className="set-section-title">输入</h2>
			<SettingsGroup label="发送">
				<SettingsRow title="发送键位">
					<select
						className="set-input"
						value={draft.input.sendKey}
						onChange={(event) =>
							patch((current) => ({
								...current,
								input: { ...current.input, sendKey: event.target.value as FacetSettings["input"]["sendKey"] },
							}))
						}
						aria-label="发送键位"
					>
						<option value="enter">回车发送</option>
						<option value="shiftEnter">Shift+回车发送</option>
					</select>
				</SettingsRow>
			</SettingsGroup>

			<SettingsGroup label="快捷键">
				{SHORTCUTS.map((item) => (
					<SettingsRow key={item.keys} title={item.action}>
						<span className="set-item-key mono">{item.keys}</span>
					</SettingsRow>
				))}
				<SettingsRow title="发送消息">
					<span className="set-item-key mono">
						{draft.input.sendKey === "shiftEnter" ? "Shift+Enter" : "Enter"}
					</span>
				</SettingsRow>
			</SettingsGroup>
		</>
	);
}

/** 已实现的快捷键，按使用频率排列。 */
const SHORTCUTS: ReadonlyArray<{ keys: string; action: string }> = [
	{ keys: "⌘K / Ctrl+K", action: "展开并聚焦侧栏搜索" },
	{ keys: "Esc", action: "关闭浮层、对话框与搜索" },
	{ keys: "Enter", action: "提交对话框里的输入" },
];

/**
 * 关于与诊断。
 *
 * 诊断文本由主机生成，凭证与令牌不在其中；导出走宿主的保存对话框，用户自己挑位置。
 */
function AboutSection({ about, data }: { about: SettingsPageProps["about"]; data: SettingsDataSource }) {
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
			setResult(saved ? { tone: "ok", message: "诊断已导出" } : { tone: "ok", message: "已取消" });
		} catch (error) {
			setResult({ tone: "error", message: error instanceof Error ? error.message : String(error) });
		} finally {
			setIsExporting(false);
		}
	};

	return (
		<section className="set-section">
			<h2 className="set-section-title">关于</h2>
			<ul className="set-list">
				<li className="set-row">
					<span className="set-row-name">应用版本</span>
					<span className="set-row-meta mono">{about.appVersion}</span>
				</li>
				<li className="set-row">
					<span className="set-row-name">运行时</span>
					<span className="set-row-meta mono">{about.runtime}</span>
				</li>
				<li className="set-row">
					<span className="set-row-name">主机端点</span>
					<span className="set-row-meta mono">{about.endpoint}</span>
				</li>
			</ul>
			<div className="set-actions">
				<button
					type="button"
					className="set-save"
					disabled={isExporting}
					onClick={() => void exportDiagnostics()}
				>
					{isExporting ? "导出中…" : "导出诊断"}
				</button>
			</div>
			{result === undefined ? null : (
				<p className={result.tone === "error" ? "set-row-error" : "set-hint"}>{result.message}</p>
			)}
		</section>
	);
}
