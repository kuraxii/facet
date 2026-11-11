/**
 * 设置页。
 *
 * 左侧分类、右侧内容；切换分类只加载该分类需要的数据，读取与保存都有明确的进行中与失败状态。
 * 保存失败时保留用户正在编辑的输入，可以直接重试。
 */
import type { FacetSettings, ModelInfo, ModelRef, ProviderInfo } from "@facet/protocol";
import { useCallback, useEffect, useState } from "react";
import { CloseIcon } from "../transcript/icons.tsx";

/** 设置分类。 */
export type SettingsSection = "providers" | "models" | "appearance" | "input" | "about";

/** 分类顺序与标题。 */
const SECTIONS: ReadonlyArray<{ key: SettingsSection; label: string }> = [
	{ key: "providers", label: "提供方" },
	{ key: "models", label: "模型" },
	{ key: "appearance", label: "外观" },
	{ key: "input", label: "输入" },
	{ key: "about", label: "关于" },
];

/** 设置的读取与保存入口，由宿主接到设备上。 */
export interface SettingsDataSource {
	/** 读设置 */
	loadSettings: () => Promise<FacetSettings>;
	/** 保存设置，失败时抛错 */
	saveSettings: (settings: FacetSettings) => Promise<FacetSettings>;
	/** 读提供方清单，含授权状态与模型数量 */
	loadProviders: () => Promise<ProviderInfo[]>;
	/** 读全部模型，模型选择与可见性都用它 */
	loadModels: () => Promise<ModelInfo[]>;
	/** 保存提供方凭证，返回更新后的提供方清单 */
	saveCredential: (providerId: string, apiKey: string) => Promise<ProviderInfo[]>;
	/** 删除提供方凭证，返回更新后的提供方清单 */
	deleteCredential: (providerId: string) => Promise<ProviderInfo[]>;
	/** 设置提供方的接口地址，空串恢复默认，返回更新后的提供方清单 */
	setProviderBaseUrl: (providerId: string, baseUrl: string) => Promise<ProviderInfo[]>;
	/** 用指定模型发一次最小请求 */
	testModel: (model: ModelRef) => Promise<{ ok: boolean; latencyMs: number; message?: string }>;
	/** 生成诊断文本 */
	diagnostics: () => Promise<string>;
	/** 保存一段文本到用户选定的文件，取消时返回 false */
	saveText: (suggestedName: string, text: string) => Promise<boolean>;
}

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
	/** 设置变化后通知宿主应用，例如外观立刻生效 */
	onSettingsApplied?: (settings: FacetSettings) => void;
	/** 应用版本等只读信息 */
	about: { appVersion: string; runtime: string; endpoint: string };
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
	about,
}: SettingsPageProps) {
	/** 已加载的设置；为空表示还没读到 */
	const [settings, setSettings] = useState<FacetSettings | undefined>(undefined);
	/** 正在编辑的那份；保存成功前不回写 settings */
	const [draft, setDraft] = useState<FacetSettings | undefined>(undefined);
	const [isLoading, setIsLoading] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
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
		if (section === "providers" || section === "about") {
			return;
		}
		if (settings !== undefined) {
			return;
		}
		void loadSettings();
	}, [loadSettings, section, settings]);

	useEffect(() => {
		if (section !== "providers" || providers !== undefined) {
			return;
		}
		void loadProviders();
	}, [loadProviders, providers, section]);

	/** 改一处草稿。 */
	const patch = (change: (current: FacetSettings) => FacetSettings): void => {
		setDraft((current) => (current === undefined ? current : change(current)));
		setSaveError(undefined);
	};

	const save = async (next: FacetSettings): Promise<void> => {
		setIsSaving(true);
		setSaveError(undefined);
		try {
			const saved = await data.saveSettings(next);
			setSettings(saved);
			setDraft(saved);
			onSettingsApplied?.(saved);
		} catch (error) {
			setSaveError(error instanceof Error ? error.message : String(error));
		} finally {
			setIsSaving(false);
		}
	};

	const isDirty =
		settings !== undefined && draft !== undefined && JSON.stringify(settings) !== JSON.stringify(draft);

	return (
		<div className="set-page">
			<header className="set-head">
				<h1 className="set-title">设置</h1>
				<button type="button" className="set-close" aria-label="关闭设置" onClick={onClose}>
					<CloseIcon size={16} />
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
					{section === "providers" ? (
						<ProvidersSection
							providers={providers}
							error={providersError}
							onRetry={loadProviders}
							onChanged={setProviders}
							data={data}
						/>
					) : null}

					{section === "about" ? <AboutSection about={about} data={data} /> : null}

					{section === "models" || section === "appearance" || section === "input" ? (
						<section className="set-section">
							{loadError === undefined ? null : (
								<StatusNote message={`读取设置失败:${loadError}`} onRetry={loadSettings} tone="error" />
							)}
							{isLoading ? <p className="set-hint">正在读取设置…</p> : null}
							{draft === undefined ? null : (
								<>
									{section === "models" ? <ModelsSection draft={draft} patch={patch} data={data} /> : null}
									{section === "appearance" ? <AppearanceSection draft={draft} patch={patch} /> : null}
									{section === "input" ? <InputSection draft={draft} patch={patch} /> : null}
									{saveError === undefined ? null : (
										<StatusNote
											message={`保存失败:${saveError}`}
											onRetry={() => void save(draft)}
											tone="error"
										/>
									)}
									<div className="set-actions">
										<button
											type="button"
											className="set-save"
											disabled={!isDirty || isSaving}
											onClick={() => void save(draft)}
										>
											{isSaving ? "保存中…" : "保存"}
										</button>
										{isDirty ? (
											<button type="button" className="set-reset" onClick={() => setDraft(settings)}>
												放弃改动
											</button>
										) : null}
									</div>
								</>
							)}
						</section>
					) : null}
				</div>
			</div>
		</div>
	);
}

/**
 * 提供方清单与凭证管理。
 *
 * 凭证只上行，界面不回显密钥内容；已配置的提供方可以替换或删除。保存与删除失败时把错误
 * 留在该提供方下面，输入的内容不清空，可以直接重试。
 */
function ProvidersSection({
	providers,
	error,
	onRetry,
	onChanged,
	data,
}: {
	providers: readonly ProviderInfo[] | undefined;
	error: string | undefined;
	onRetry: () => void;
	onChanged: (providers: ProviderInfo[]) => void;
	data: SettingsDataSource;
}) {
	/** 展开凭证输入的提供方 */
	const [editingId, setEditingId] = useState<string | undefined>(undefined);
	/** 展开地址输入的提供方 */
	const [addressId, setAddressId] = useState<string | undefined>(undefined);
	const [address, setAddress] = useState("");
	const [key, setKey] = useState("");
	const [busyId, setBusyId] = useState<string | undefined>(undefined);
	const [failure, setFailure] = useState<{ providerId: string; message: string } | undefined>(undefined);

	if (error !== undefined) {
		return (
			<section className="set-section">
				<h2 className="set-section-title">提供方</h2>
				<StatusNote message={`读取提供方失败:${error}`} onRetry={onRetry} tone="error" />
			</section>
		);
	}
	if (providers === undefined) {
		return (
			<section className="set-section">
				<h2 className="set-section-title">提供方</h2>
				<p className="set-hint">正在读取提供方…</p>
			</section>
		);
	}

	const submit = async (providerId: string) => {
		setBusyId(providerId);
		setFailure(undefined);
		try {
			onChanged(await data.saveCredential(providerId, key));
			setEditingId(undefined);
			setKey("");
		} catch (saveError) {
			setFailure({
				providerId,
				message: saveError instanceof Error ? saveError.message : String(saveError),
			});
		} finally {
			setBusyId(undefined);
		}
	};

	/** 保存接口地址，空串表示恢复默认。 */
	const saveAddress = async (providerId: string) => {
		setBusyId(providerId);
		setFailure(undefined);
		try {
			onChanged(await data.setProviderBaseUrl(providerId, address));
			setAddressId(undefined);
			setAddress("");
		} catch (saveError) {
			setFailure({
				providerId,
				message: saveError instanceof Error ? saveError.message : String(saveError),
			});
		} finally {
			setBusyId(undefined);
		}
	};

	const remove = async (providerId: string) => {
		setBusyId(providerId);
		setFailure(undefined);
		try {
			onChanged(await data.deleteCredential(providerId));
		} catch (removeError) {
			setFailure({
				providerId,
				message: removeError instanceof Error ? removeError.message : String(removeError),
			});
		} finally {
			setBusyId(undefined);
		}
	};

	return (
		<section className="set-section">
			<h2 className="set-section-title">提供方</h2>
			<p className="set-hint">凭证保存在设备上，界面不回显密钥内容，也不进入日志。</p>
			<ul className="set-list">
				{providers.map((provider) => {
					const isEditing = editingId === provider.id;
					const isBusy = busyId === provider.id;
					return (
						<li key={provider.id} className="set-row is-block">
							<div className="set-row-head">
								<span className="set-row-name">{provider.name}</span>
								<span className={provider.authenticated ? "set-badge is-on" : "set-badge"}>
									{provider.authenticated
										? provider.subscription
											? "订阅登录"
											: "已配置凭证"
										: "未配置凭证"}
								</span>
								{provider.authSource === undefined ? null : (
									<span className="set-row-meta mono">{provider.authSource}</span>
								)}
								<span className="set-row-meta mono">{provider.modelCount} 个模型</span>
								<button
									type="button"
									className="set-row-action"
									onClick={() => {
										setFailure(undefined);
										setKey("");
										setEditingId(isEditing ? undefined : provider.id);
									}}
								>
									{provider.authenticated ? "替换凭证" : "添加凭证"}
								</button>
								<button
									type="button"
									className="set-row-action"
									onClick={() => {
										setFailure(undefined);
										setAddress(provider.baseUrlOverride ?? "");
										setAddressId(addressId === provider.id ? undefined : provider.id);
									}}
								>
									地址
								</button>
								{provider.authenticated ? (
									<button
										type="button"
										className="set-row-action is-danger"
										disabled={isBusy}
										onClick={() => void remove(provider.id)}
									>
										删除
									</button>
								) : null}
							</div>

							{isEditing ? (
								<div className="set-row-edit">
									<input
										className="set-input mono"
										type="password"
										value={key}
										onChange={(event) => setKey(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter" && key.trim().length > 0) {
												void submit(provider.id);
											}
										}}
										placeholder="粘贴 API key"
										aria-label={`${provider.name} 的 API key`}
									/>
									<button
										type="button"
										className="set-save"
										disabled={isBusy || key.trim().length === 0}
										onClick={() => void submit(provider.id)}
									>
										{isBusy ? "保存中…" : "保存"}
									</button>
								</div>
							) : null}

							{addressId === provider.id ? (
								<p className="set-hint mono">
									当前生效:{provider.baseUrl ?? "由提供方决定"}
									{provider.baseUrlOverride === undefined ? "" : "（已覆写）"}
								</p>
							) : null}
							{addressId === provider.id ? (
								<div className="set-row-edit">
									<input
										className="set-input mono"
										value={address}
										onChange={(event) => setAddress(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												void saveAddress(provider.id);
											}
										}}
										placeholder="接口地址,留空恢复默认"
										aria-label={`${provider.name} 的接口地址`}
									/>
									<button
										type="button"
										className="set-save"
										disabled={isBusy}
										onClick={() => void saveAddress(provider.id)}
									>
										{isBusy ? "保存中…" : "保存"}
									</button>
								</div>
							) : null}
							{failure?.providerId === provider.id ? (
								<p className="set-row-error">{failure.message}</p>
							) : null}
						</li>
					);
				})}
				{providers.length === 0 ? <li className="set-row set-row-empty">没有可用的提供方</li> : null}
			</ul>
		</section>
	);
}

/** 模型键，模型可见性与选择器共用。 */
function modelKey(model: ModelRef): string {
	return `${model.provider}/${model.id}`;
}

/**
 * 模型设置。
 *
 * 默认模型与默认思考档位决定新建会话用什么；档位按所选模型是否支持思考来筛，不支持时
 * 只留「不思考」。可见性决定模型选择器里出现哪些模型，已有会话的模型不受影响。
 */
function ModelsSection({
	draft,
	patch,
	data,
}: {
	draft: FacetSettings;
	patch: (change: (current: FacetSettings) => FacetSettings) => void;
	data: SettingsDataSource;
}) {
	const [models, setModels] = useState<readonly ModelInfo[] | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	/** 每个模型的测试结果，键为 provider/model */
	const [tests, setTests] = useState<
		Record<string, { ok: boolean; latencyMs: number; message?: string } | undefined>
	>({});
	/** 正在测试的模型 */
	const [testing, setTesting] = useState<string | undefined>(undefined);

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

	const selected = draft.defaultModel;
	// 选中的模型不支持思考时,只保留「不思考」一档
	const selectedModel =
		selected === undefined ? undefined : models.find((model) => modelKey(model) === modelKey(selected));
	const levelOptions =
		selectedModel === undefined || selectedModel.reasoning ? THINKING_LEVEL_OPTIONS : (["off"] as const);

	return (
		<>
			<h2 className="set-section-title">模型</h2>
			<p className="set-hint">新建会话采用这里的默认模型与思考档位；已有会话保持自己的选择。</p>
			<label className="set-field">
				<span className="set-label">默认模型</span>
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
					<option value="">由设备决定</option>
					{models.map((model) => (
						<option key={modelKey(model)} value={modelKey(model)}>
							{model.provider} / {model.name}
						</option>
					))}
				</select>
			</label>
			<label className="set-field">
				<span className="set-label">默认思考档位</span>
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
			</label>
			{selectedModel !== undefined && !selectedModel.reasoning ? (
				<p className="set-hint">这个模型不支持思考，档位只保留「off」。</p>
			) : null}

			<h3 className="set-section-subtitle">模型可见性</h3>
			<p className="set-hint">隐藏的模型不出现在模型选择器里，已经用着它的会话不受影响。</p>
			<ul className="set-list set-list-scroll">
				{models.map((model) => {
					const key = modelKey(model);
					const isHidden = draft.hiddenModels.includes(key);
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
								<label className="set-toggle">
									<input
										type="checkbox"
										checked={!isHidden}
										onChange={(event) =>
											patch((current) => ({
												...current,
												hiddenModels: event.target.checked
													? current.hiddenModels.filter((item) => item !== key)
													: [...current.hiddenModels, key],
											}))
										}
									/>
									<span>{isHidden ? "已隐藏" : "显示"}</span>
								</label>
							</div>
							{probe?.message === undefined ? null : <p className="set-row-error">{probe.message}</p>}
						</li>
					);
				})}
				{models.length === 0 ? <li className="set-row set-row-empty">没有可用的模型</li> : null}
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
}: {
	draft: FacetSettings;
	patch: (change: (current: FacetSettings) => FacetSettings) => void;
}) {
	const appearance = draft.appearance;
	return (
		<>
			<h2 className="set-section-title">外观</h2>
			<label className="set-field">
				<span className="set-label">主题</span>
				<select
					className="set-input"
					value={appearance.theme}
					onChange={(event) =>
						patch((current) => ({
							...current,
							appearance: {
								...current.appearance,
								theme: event.target.value as FacetSettings["appearance"]["theme"],
							},
						}))
					}
					aria-label="主题"
				>
					<option value="dark">深色</option>
					<option value="light">浅色</option>
					<option value="system">跟随系统</option>
				</select>
			</label>
			<label className="set-field">
				<span className="set-label">正文字体</span>
				<input
					className="set-input"
					value={appearance.bodyFont}
					onChange={(event) =>
						patch((current) => ({
							...current,
							appearance: { ...current.appearance, bodyFont: event.target.value },
						}))
					}
					placeholder="留空使用界面默认字体"
					aria-label="正文字体"
				/>
			</label>
			<label className="set-field">
				<span className="set-label">代码字体</span>
				<input
					className="set-input"
					value={appearance.codeFont}
					onChange={(event) =>
						patch((current) => ({
							...current,
							appearance: { ...current.appearance, codeFont: event.target.value },
						}))
					}
					placeholder="留空使用界面默认等宽字体"
					aria-label="代码字体"
				/>
			</label>
			<label className="set-field">
				<span className="set-label">正文字号</span>
				<input
					className="set-input mono"
					type="number"
					min={11}
					max={20}
					value={appearance.fontSize}
					onChange={(event) => {
						const value = Number(event.target.value);
						patch((current) => ({
							...current,
							appearance: {
								...current.appearance,
								fontSize: Number.isFinite(value) ? value : current.appearance.fontSize,
							},
						}));
					}}
					aria-label="正文字号"
				/>
			</label>
			<label className="set-check">
				<input
					type="checkbox"
					checked={appearance.reducedMotion}
					onChange={(event) =>
						patch((current) => ({
							...current,
							appearance: { ...current.appearance, reducedMotion: event.target.checked },
						}))
					}
				/>
				<span>减少动效</span>
			</label>
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
			<label className="set-field">
				<span className="set-label">发送键位</span>
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
					<option value="enter">回车发送,Shift+回车换行</option>
					<option value="shiftEnter">Shift+回车发送,回车换行</option>
				</select>
			</label>

			<h3 className="set-section-subtitle">快捷键</h3>
			<ul className="set-list">
				{SHORTCUTS.map((item) => (
					<li key={item.keys} className="set-row">
						<span className="set-row-name">{item.action}</span>
						<span className="set-row-meta mono">{item.keys}</span>
					</li>
				))}
				<li className="set-row">
					<span className="set-row-name">发送消息</span>
					<span className="set-row-meta mono">
						{draft.input.sendKey === "shiftEnter" ? "Shift+Enter" : "Enter"}
					</span>
				</li>
			</ul>
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
 * 诊断文本由设备生成，凭证与令牌不在其中；导出走宿主的保存对话框，用户自己挑位置。
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
					<span className="set-row-name">设备端点</span>
					<span className="set-row-meta mono">{about.endpoint}</span>
				</li>
			</ul>
			<p className="set-hint">诊断包含版本、平台、数据目录与模型状态，凭证与令牌不会写进去。</p>
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
