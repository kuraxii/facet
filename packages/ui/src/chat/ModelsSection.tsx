/**
 * 模型设置页。
 *
 * 一页放三件事：新建会话采用的默认思考档位、已配置的提供方、可用模型的连通性测试。
 * 提供方的地址、凭证与自定义清单都收在同一个编辑弹窗里，列表行只留名字、来源、凭证状态与
 * 「编辑」；凭证状态用行尾的小圆点表示，不在行里排一排按钮。
 */
import type {
	AgentDefaults,
	CustomProviderInfo,
	ModelInfo,
	ModelRef,
	ProviderInfo,
	ThinkingLevel,
} from "@facet/protocol";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Badge } from "../common/Badge.tsx";
import { Button } from "../common/Button.tsx";
import { Select, type SelectOption } from "../common/select.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ProviderDialog } from "./ProviderDialog.tsx";
import { ProviderPicker } from "./ProviderPicker.tsx";
import { type ProviderRow, providerRows } from "./provider-rows.ts";
import type { SettingsDataSource } from "./settings-data-source.ts";
import { SettingsGroup, SettingsRow, StatusNote } from "./settings-layout.tsx";

/** 模型键，模型可见性与选择器共用。 */
function modelKey(model: ModelRef): string {
	return `${model.provider}/${model.id}`;
}

/**
 * 默认模型下拉的选项。
 *
 * 顺序是：没选默认模型时的「由模型决定」占位、当前能用的模型、以及 pi 里存着但已经不在
 * 可用范围里的那一个（换过凭证或删过提供方也会列出来，否则这个值在界面上会「消失」）。
 */
function modelOptions(
	current: ModelRef | undefined,
	usable: readonly ModelInfo[] | undefined,
	defaultLabel: string,
): SelectOption[] {
	const options: SelectOption[] = [];
	if (current === undefined) {
		options.push({ value: "", label: defaultLabel });
	}
	for (const model of usable ?? []) {
		options.push({ value: modelKey(model), label: `${model.provider} / ${model.name}` });
	}
	if (current !== undefined && !(usable ?? []).some((model) => modelKey(model) === modelKey(current))) {
		options.push({ value: modelKey(current), label: `${current.provider} / ${current.id}` });
	}
	return options;
}

/** 思考档位的取值，与协议里的 ThinkingLevel 一致。 */
const THINKING_LEVEL_OPTIONS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
type ThinkingLevelValue = (typeof THINKING_LEVEL_OPTIONS)[number];

/** 页面上一次测试的结果。 */
interface ProbeResult {
	/** 这次请求是否成功 */
	ok: boolean;
	/** 往返耗时，毫秒 */
	latencyMs: number;
	/** 失败时主机的原话 */
	message?: string;
}

/** 模型页参数。 */
export interface ModelsSectionProps {
	/** 数据来源 */
	data: SettingsDataSource;
	/** pi 目录里的提供方，含自定义 */
	providers: readonly ProviderInfo[] | undefined;
	/** 读取提供方失败的原因 */
	providersError: string | undefined;
	/** 重新读取提供方 */
	onReloadProviders: () => void;
}

export function ModelsSection({
	data,
	providers,
	providersError,
	onReloadProviders,
}: ModelsSectionProps): React.JSX.Element {
	const { t } = useI18n();
	const [models, setModels] = useState<readonly ModelInfo[] | undefined>(undefined);
	const [modelsError, setModelsError] = useState<string | undefined>(undefined);
	/** 每个模型的测试结果，键为 provider/model */
	const [probes, setProbes] = useState<Record<string, ProbeResult | undefined>>({});
	/** 正在测试的模型 */
	const [testing, setTesting] = useState<string | undefined>(undefined);
	/** 自定义提供方的完整配置，提供方列表与模型筛选用同一份 */
	const [customs, setCustoms] = useState<readonly CustomProviderInfo[] | undefined>(undefined);
	/** pi 自己的默认设置：存在 pi 的设置里，新建会话由它开局 */
	const [defaults, setDefaults] = useState<AgentDefaults | undefined>(undefined);
	/** 正在写 pi 的默认设置 */
	const [isSavingDefaults, setIsSavingDefaults] = useState(false);
	/** 添加提供商的挑选弹窗 */
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	/** 正在编辑的提供方；打开新表单时 `row` 为空 */
	const [editing, setEditing] = useState<{ row: ProviderRow | undefined } | undefined>(undefined);

	const loadModels = useCallback(async () => {
		setModelsError(undefined);
		try {
			setModels(await data.loadModels());
		} catch (loadError) {
			setModelsError(loadError instanceof Error ? loadError.message : String(loadError));
		}
	}, [data]);

	const loadCustoms = useCallback(async () => {
		try {
			setCustoms(await data.listCustomProviders());
		} catch {
			setCustoms([]);
		}
	}, [data]);

	useEffect(() => {
		if (models !== undefined) {
			return;
		}
		void loadModels();
	}, [loadModels, models]);

	useEffect(() => {
		if (customs !== undefined) {
			return;
		}
		void loadCustoms();
	}, [customs, loadCustoms]);

	useEffect(() => {
		let alive = true;
		void data
			.loadAgentDefaults()
			.then((loaded) => {
				if (alive) {
					setDefaults(loaded);
				}
			})
			.catch(() => undefined);
		return () => {
			alive = false;
		};
	}, [data]);

	/** 改 pi 的默认设置：写完以主机读回的值重新对齐。 */
	const changeDefaults = async (patch: {
		model?: ModelRef;
		thinkingLevel?: ThinkingLevel | null;
		autoCompaction?: boolean;
	}): Promise<void> => {
		setIsSavingDefaults(true);
		try {
			setDefaults(await data.saveAgentDefaults(patch));
		} catch {
			// 写不进去就按主机上实际生效的值回位
			void data
				.loadAgentDefaults()
				.then(setDefaults)
				.catch(() => undefined);
		} finally {
			setIsSavingDefaults(false);
		}
	};

	/** 提供方或凭证变过：清单与可用模型都要重读，可用范围跟着凭证走。 */
	const reloadProviders = useCallback(() => {
		onReloadProviders();
		void loadModels();
		void loadCustoms();
	}, [loadCustoms, loadModels, onReloadProviders]);

	/** 发一次最小请求，结果留在该模型那一行。 */
	const runTest = async (model: ModelInfo): Promise<void> => {
		const key = modelKey(model);
		setTesting(key);
		try {
			const result = await data.testModel({ provider: model.provider, id: model.id });
			setProbes((current) => ({ ...current, [key]: result }));
		} catch (testError) {
			setProbes((current) => ({
				...current,
				[key]: { ok: false, latencyMs: 0, message: messageOf(testError) },
			}));
		} finally {
			setTesting(undefined);
		}
	};

	const allRows = providers === undefined ? undefined : providerRows(providers, customs ?? []);
	// 列表只显示在用的：有凭证或本身就是自定义的
	const rows = allRows?.filter(({ provider, custom }) => provider.authenticated || custom !== undefined);
	// 可用模型也只列这些提供方的：没配置凭证的提供方用不了，列出来只是噪声
	const usable =
		models === undefined || rows === undefined
			? undefined
			: (() => {
					const configured = new Set(rows.map(({ provider }) => provider.id));
					return models.filter((model) => configured.has(model.provider));
				})();

	/** 某个提供方目录里的模型，内置提供方的编辑弹窗只读展示它。 */
	const modelsOf = (providerId: string): readonly ModelInfo[] =>
		(models ?? []).filter((model) => model.provider === providerId);

	return (
		<div className="set-models">
			<SettingsGroup>
				<SettingsRow title={t("settings.modelsPage.defaultModel")}>
					<Select
						value={defaults?.model === undefined ? "" : modelKey(defaults.model)}
						options={modelOptions(defaults?.model, usable, t("settings.modelsPage.modelDefault"))}
						disabled={isSavingDefaults || usable === undefined}
						onChange={(value) => {
							const separator = value.indexOf("/");
							if (separator > 0) {
								void changeDefaults({
									model: { provider: value.slice(0, separator), id: value.slice(separator + 1) },
								});
							}
						}}
						ariaLabel={t("settings.modelsPage.defaultModel")}
					/>
				</SettingsRow>
				<SettingsRow title={t("settings.modelsPage.defaultThinking")}>
					<Select
						value={defaults?.thinkingLevel ?? ""}
						options={[
							{ value: "", label: t("settings.modelsPage.modelDefault") },
							...THINKING_LEVEL_OPTIONS.map((level) => ({ value: level, label: level })),
						]}
						disabled={isSavingDefaults}
						onChange={(value) => {
							void changeDefaults({
								thinkingLevel: value.length === 0 ? null : (value as ThinkingLevelValue),
							});
						}}
						ariaLabel={t("settings.modelsPage.defaultThinking")}
					/>
				</SettingsRow>
				<SettingsRow title={t("settings.modelsPage.autoCompaction")}>
					<input
						type="checkbox"
						role="switch"
						aria-checked={defaults?.autoCompaction ?? true}
						className="set-switch"
						disabled={isSavingDefaults || defaults === undefined}
						checked={defaults?.autoCompaction ?? true}
						onChange={(event) => {
							void changeDefaults({ autoCompaction: event.target.checked });
						}}
						aria-label={t("settings.modelsPage.autoCompaction")}
					/>
				</SettingsRow>
			</SettingsGroup>

			<section className="set-models-group">
				<div className="set-models-group-head">
					<h3 className="set-models-group-title">
						{t("providers.configured")}
						{rows === undefined ? null : ` · ${rows.length}`}
					</h3>
					<Button variant="primary" size="sm" onClick={() => setIsPickerOpen(true)}>
						<Plus size={ICON_SIZE.md} aria-hidden="true" />
						{t("providers.addProvider")}
					</Button>
				</div>
				{providersError === undefined ? null : (
					<StatusNote
						message={t("providers.readFailed", { error: providersError })}
						onRetry={onReloadProviders}
					/>
				)}
				{providersError !== undefined ? null : rows === undefined ? (
					<p className="set-hint">{t("providers.loading")}</p>
				) : (
					<ul className="set-models-list">
						{rows.map((row) => (
							<ProviderListRow key={row.provider.id} row={row} onEdit={() => setEditing({ row })} />
						))}
						{rows.length === 0 ? (
							<li className="set-models-row">
								<span className="set-hint">{t("providers.noProviders")}</span>
							</li>
						) : null}
					</ul>
				)}
			</section>

			<section className="set-models-group">
				<h3 className="set-models-group-title">{t("settings.modelsPage.available")}</h3>
				{modelsError === undefined ? null : (
					<StatusNote
						message={t("settings.modelsPage.readFailed", { error: modelsError })}
						onRetry={() => void loadModels()}
					/>
				)}
				{modelsError !== undefined ? null : usable === undefined ? (
					<p className="set-hint">{t("settings.modelsPage.loading")}</p>
				) : (
					<ul className="set-models-list">
						{usable.map((model) => {
							const key = modelKey(model);
							const probe = probes[key];
							return (
								<li key={key} className="set-models-row">
									<span className="set-models-text">
										<span className="set-models-name ell">{model.name}</span>
										<span className="set-models-meta ell mono">
											{model.provider} · {model.id}
										</span>
										{probe?.message === undefined ? null : (
											<span className="set-row-error">{probe.message}</span>
										)}
									</span>
									{probe === undefined ? null : (
										<span className="set-models-probe">
											<i
												className={probe.ok ? "set-models-dot is-on" : "set-models-dot is-off"}
												role="status"
												aria-label={
													probe.ok
														? t("settings.modelsPage.probeAvailable", { latency: probe.latencyMs })
														: t("settings.modelsPage.probeUnavailable")
												}
											/>
											{probe.ok ? (
												<span className="set-models-latency mono">{probe.latencyMs} ms</span>
											) : null}
										</span>
									)}
									<Button
										variant="secondary"
										size="sm"
										disabled={testing === key}
										onClick={() => void runTest(model)}
									>
										{t("settings.modelsPage.test")}
									</Button>
								</li>
							);
						})}
						{usable.length === 0 ? (
							<li className="set-models-row">
								<span className="set-hint">{t("settings.modelsPage.noModels")}</span>
							</li>
						) : null}
					</ul>
				)}
			</section>

			{isPickerOpen ? (
				<ProviderPicker
					rows={allRows ?? []}
					onPick={(providerId) => {
						const picked = allRows?.find(({ provider }) => provider.id === providerId);
						if (picked === undefined) {
							return;
						}
						// 挑选弹窗只负责挑，凭证与地址交给编辑弹窗；两层弹层不叠在一起
						setIsPickerOpen(false);
						setEditing({ row: picked });
					}}
					onCreateCustom={() => {
						setIsPickerOpen(false);
						setEditing({ row: undefined });
					}}
					onClose={() => setIsPickerOpen(false)}
				/>
			) : null}

			{editing === undefined ? null : (
				<ProviderDialog
					row={editing.row}
					models={editing.row === undefined ? [] : modelsOf(editing.row.provider.id)}
					data={data}
					onChanged={reloadProviders}
					onClose={() => setEditing(undefined)}
				/>
			)}
		</div>
	);
}

/** 提供方列表里的一行：行首是名字首字母，行尾只在不缺密钥时不加标记，缺的时候给一个告警点。 */
function ProviderListRow({ row, onEdit }: { row: ProviderRow; onEdit: () => void }): React.JSX.Element {
	const { t } = useI18n();
	const { provider, custom } = row;
	return (
		<li className="set-models-row">
			<span className="set-models-mark" aria-hidden="true">
				{provider.name.slice(0, 1).toUpperCase()}
			</span>
			<span className="set-models-title">
				<span className="set-models-name ell">{provider.name}</span>
				{custom === undefined ? null : <Badge shape="tag">{t("providers.custom")}</Badge>}
			</span>
			{provider.authenticated ? null : (
				<span className="set-models-dot is-off" role="status" aria-label={t("providers.credentialMissing")} />
			)}
			<Button variant="secondary" size="sm" onClick={onEdit}>
				{t("providers.edit")}
			</Button>
		</li>
	);
}

/** 取错误对象里的一句话。 */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
