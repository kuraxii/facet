/**
 * 提供方编辑弹窗。
 *
 * 一个提供方要改的东西都收在这里：接口地址、凭证与模型清单。内置提供方的名字、协议与模型由
 * pi 的目录给定，只能换地址与凭证；自定义提供方全部可改；新建时标识按名字自动推出。
 * 凭证与清单分别写在两处配置里，所以保存时按「先建提供方、再写凭证」的顺序提交。
 */
import type { CustomModelInfo, ModelInfo } from "@facet/protocol";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import { Modal } from "../modal.tsx";
import { API_OPTIONS, apiOptionLabel } from "./provider-api.ts";
import type { ProviderRow } from "./provider-rows.ts";
import type { SettingsDataSource } from "./settings-data-source.ts";

/** 表单里的一行模型。`key` 只用于渲染，跟着行一起移动，不用下标当键。 */
interface ModelRow {
	key: string;
	model: CustomModelInfo;
}

let rowCounter = 0;

/** 造一行模型。 */
function modelRow(model: CustomModelInfo = { id: "" }): ModelRow {
	rowCounter += 1;
	return { key: `row-${rowCounter}`, model };
}

/** 从名字推一个标识：标识只认小写字母、数字、点、下划线与连字符。 */
function slugify(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "");
}

/** 取错误对象里的一句话。 */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 弹窗参数。 */
export interface ProviderDialogProps {
	/** 正在编辑的提供方；为空表示新建自定义提供方 */
	row?: ProviderRow;
	/** 这个提供方目录里的模型，内置提供方只读展示 */
	models: readonly ModelInfo[];
	/** 数据来源 */
	data: SettingsDataSource;
	/** 提供方清单变化后通知上层重新读取 */
	onChanged: () => void;
	/** 关闭弹窗 */
	onClose: () => void;
}

export function ProviderDialog({
	row,
	models,
	data,
	onChanged,
	onClose,
}: ProviderDialogProps): React.JSX.Element {
	const { t } = useI18n();
	const custom = row?.custom;
	const provider = row?.provider;
	const isNew = row === undefined;
	const isCustom = isNew || custom !== undefined;
	/** 弹窗里维护的提供方标识：内置的由目录给定，自定义的可以改 */
	const providerId = provider?.id ?? "";

	const [name, setName] = useState(custom?.name ?? "");
	/** 标识；新建时跟着名字走，用户改过之后就不再覆盖 */
	const [id, setId] = useState(custom?.id ?? "");
	const [idTouched, setIdTouched] = useState(!isNew);
	const [baseUrl, setBaseUrl] = useState(custom?.baseUrl ?? provider?.baseUrlOverride ?? "");
	const [api, setApi] = useState(custom?.api ?? API_OPTIONS[0]?.value ?? "openai-completions");
	const [rows, setRows] = useState<ModelRow[]>(() =>
		custom === undefined ? [modelRow()] : custom.models.map((model) => modelRow(model)),
	);

	/** 凭证是否已配置；弹窗里刚换过的以这里为准，不等上层刷新 */
	const [hasCredential, setHasCredential] = useState(provider?.authenticated === true);
	/** 正在输入的凭证；新建时随保存一起写入 */
	const [key, setKey] = useState("");
	/** 已配置凭证时是否展开了输入框 */
	const [isReplacing, setIsReplacing] = useState(provider?.authenticated !== true);
	const [isBusy, setIsBusy] = useState(false);
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	const shownId = isNew ? id : providerId;

	const patchModel = (key_: string, change: Partial<CustomModelInfo>): void => {
		setRows((current) =>
			current.map((item) => (item.key === key_ ? { ...item, model: { ...item.model, ...change } } : item)),
		);
	};

	/** 提交前的本地校验，只说最明显的几条；主机侧还会再校验一次。 */
	const validate = (): string | undefined => {
		if (!isCustom) {
			return undefined;
		}
		if (!/^[a-z0-9][a-z0-9._-]*$/.test(shownId.trim())) {
			return t("providerForm.invalidId");
		}
		if (name.trim().length === 0) {
			return t("providerForm.invalidName");
		}
		if (baseUrl.trim().length === 0) {
			return t("providerForm.invalidBaseUrl");
		}
		if (rows.length === 0 || rows.some((item) => item.model.id.trim().length === 0)) {
			return t("providerForm.invalidModelId");
		}
		return undefined;
	};

	const save = async (): Promise<void> => {
		const invalid = validate();
		if (invalid !== undefined) {
			setError(invalid);
			return;
		}
		setIsBusy(true);
		setError(undefined);
		try {
			if (isCustom) {
				await data.saveCustomProvider({
					id: shownId.trim(),
					name: name.trim(),
					baseUrl: baseUrl.trim(),
					api,
					models: rows.map((item) => ({ ...item.model, id: item.model.id.trim() })),
				});
			} else if (baseUrl !== (provider?.baseUrlOverride ?? "")) {
				await data.setProviderBaseUrl(shownId, baseUrl);
			}
			// 凭证与地址分两处存放：地址走上面那一步，凭证统一在这里写，新建的提供方到这一步才存在
			if (key.trim().length > 0) {
				await data.saveCredential(shownId, key.trim());
			}
			onChanged();
			onClose();
		} catch (saveError) {
			setError(messageOf(saveError));
		} finally {
			setIsBusy(false);
		}
	};

	/** 已存在的提供方换凭证：不等整张表单，存完就能看到状态变成已配置。 */
	const commitKey = async (): Promise<void> => {
		if (key.trim().length === 0) {
			return;
		}
		setIsBusy(true);
		setError(undefined);
		try {
			await data.saveCredential(shownId, key.trim());
			setKey("");
			setHasCredential(true);
			setIsReplacing(false);
			onChanged();
		} catch (saveError) {
			setError(messageOf(saveError));
		} finally {
			setIsBusy(false);
		}
	};

	const removeKey = async (): Promise<void> => {
		setIsBusy(true);
		setError(undefined);
		try {
			await data.deleteCredential(shownId);
			setHasCredential(false);
			setIsReplacing(true);
			onChanged();
		} catch (removeError) {
			setError(messageOf(removeError));
		} finally {
			setIsBusy(false);
		}
	};

	const removeProvider = async (): Promise<void> => {
		setIsBusy(true);
		setError(undefined);
		try {
			await data.removeCustomProvider(shownId);
			onChanged();
			onClose();
		} catch (removeError) {
			setError(messageOf(removeError));
		} finally {
			setIsBusy(false);
		}
	};

	const title = isNew
		? t("providerForm.addTitle")
		: t("providers.editTitle", { name: custom?.name ?? provider?.name ?? "" });

	return (
		<Modal open onClose={onClose} label={title} className="is-provider">
			<header className="prov-head">
				<h2 className="dialog-title">{title}</h2>
				<button type="button" className="dialog-close" aria-label={t("common.close")} onClick={onClose}>
					<X size={18} strokeWidth={1.5} />
				</button>
			</header>

			<div className="prov-body">
				{isCustom ? (
					<div className="prov-pair">
						<label className="set-field">
							<span className="set-label">{t("providerForm.name")}</span>
							<input
								className="set-input"
								value={name}
								onChange={(event) => {
									const next = event.target.value;
									setName(next);
									if (!idTouched) {
										setId(slugify(next));
									}
								}}
								placeholder={t("providerForm.name")}
								aria-label={t("providerForm.name")}
								data-autofocus
							/>
						</label>
						<label className="set-field">
							<span className="set-label">{t("providerForm.id")}</span>
							<input
								className="set-input mono"
								value={shownId}
								// 已经存在的提供方改标识等于换一个提供方，配置对不上，所以只在新建时可改
								disabled={!isNew}
								onChange={(event) => {
									setIdTouched(true);
									setId(event.target.value);
								}}
								placeholder="my-gateway"
								aria-label={t("providerForm.id")}
							/>
						</label>
					</div>
				) : null}

				<label className="set-field">
					<span className="set-label">{t("providerForm.baseUrl")}</span>
					<input
						className="set-input mono"
						value={baseUrl}
						onChange={(event) => setBaseUrl(event.target.value)}
						placeholder={provider?.baseUrl ?? "https://gateway.example.com/v1"}
						aria-label={t("providerForm.baseUrl")}
						{...(!isCustom ? { "data-autofocus": true } : {})}
					/>
				</label>

				{isCustom ? (
					<label className="set-field">
						<span className="set-label">{t("providerForm.api")}</span>
						<select
							className="set-input"
							value={api}
							onChange={(event) => setApi(event.target.value)}
							aria-label={t("providerForm.api")}
						>
							{API_OPTIONS.map((option) => (
								<option key={option.value} value={option.value}>
									{apiOptionLabel(option, t)}
								</option>
							))}
						</select>
					</label>
				) : null}

				<section className="prov-section">
					<span className="set-label">{t("providerForm.credential")}</span>
					<div className="prov-cred">
						<span className="prov-cred-state">
							<i
								className={hasCredential ? "set-models-dot is-on" : "set-models-dot is-off"}
								role="status"
								aria-label={hasCredential ? t("providers.credential") : t("providers.credentialMissing")}
							/>
							{provider?.authSource === undefined ? null : (
								<span className="prov-cred-source mono">{provider.authSource}</span>
							)}
						</span>

						{hasCredential && !isReplacing ? (
							<span className="prov-cred-actions">
								<button type="button" className="prov-btn" onClick={() => setIsReplacing(true)}>
									{t("providers.replaceCredential")}
								</button>
								<button
									type="button"
									className="prov-btn is-danger"
									disabled={isBusy}
									onClick={() => void removeKey()}
								>
									{t("providers.deleteCredential")}
								</button>
							</span>
						) : (
							<span className="prov-key">
								<input
									className="set-input mono"
									type="password"
									value={key}
									onChange={(event) => setKey(event.target.value)}
									onKeyDown={(event) => {
										if (event.key === "Enter" && !isComposingKey(event)) {
											if (isNew) {
												void save();
											} else {
												void commitKey();
											}
										}
									}}
									placeholder={t("providers.apiKeyPlaceholder")}
									aria-label={t("providers.apiKeyLabel", {
										name: custom?.name ?? provider?.name ?? "",
									})}
								/>
								{isNew ? null : (
									<button
										type="button"
										className="set-save"
										disabled={isBusy || key.trim().length === 0}
										onClick={() => void commitKey()}
									>
										{isBusy ? t("providers.saving") : t("common.save")}
									</button>
								)}
							</span>
						)}
					</div>
				</section>

				{isCustom ? (
					<section className="prov-section">
						<div className="prov-section-head">
							<span className="set-label">{t("providerForm.models")}</span>
							<button
								type="button"
								className="prov-btn is-ghost"
								onClick={() => setRows((current) => [...current, modelRow()])}
							>
								<Plus size={13} strokeWidth={2} aria-hidden="true" />
								{t("providerForm.addModel")}
							</button>
						</div>
						<div className="prov-model-head" aria-hidden="true">
							<span>{t("providerForm.modelId")}</span>
							<span>{t("providerForm.modelName")}</span>
							<span>{t("providerForm.contextWindow")}</span>
							<span>{t("providerForm.maxOutput")}</span>
							<span>{t("providerForm.supportsThinking")}</span>
							<span />
						</div>
						<ul className="prov-models">
							{rows.map((row_, index) => {
								const model = row_.model;
								return (
									<li key={row_.key} className="prov-model">
										<input
											className="set-input mono"
											value={model.id}
											onChange={(event) => patchModel(row_.key, { id: event.target.value })}
											placeholder={t("providerForm.modelId")}
											aria-label={t("providerForm.modelIdLabel", { index: index + 1 })}
										/>
										<input
											className="set-input"
											value={model.name ?? ""}
											onChange={(event) => patchModel(row_.key, { name: event.target.value })}
											placeholder={t("providerForm.modelName")}
											aria-label={t("providerForm.modelNameLabel", { index: index + 1 })}
										/>
										<input
											className="set-input mono"
											type="number"
											value={model.contextWindow ?? ""}
											onChange={(event) =>
												patchModel(row_.key, {
													contextWindow: event.target.value === "" ? undefined : Number(event.target.value),
												})
											}
											placeholder={t("providerForm.contextWindow")}
											aria-label={t("providerForm.modelContextLabel", { index: index + 1 })}
										/>
										<input
											className="set-input mono"
											type="number"
											value={model.maxTokens ?? ""}
											onChange={(event) =>
												patchModel(row_.key, {
													maxTokens: event.target.value === "" ? undefined : Number(event.target.value),
												})
											}
											placeholder={t("providerForm.maxOutput")}
											aria-label={t("providerForm.modelOutputLabel", { index: index + 1 })}
										/>
										<label className="prov-toggle">
											<input
												type="checkbox"
												checked={model.reasoning === true}
												onChange={(event) => patchModel(row_.key, { reasoning: event.target.checked })}
												aria-label={t("providerForm.supportsThinking")}
											/>
										</label>
										<button
											type="button"
											className="prov-btn is-icon"
											aria-label={t("providerForm.remove")}
											disabled={rows.length <= 1}
											onClick={() => setRows((current) => current.filter((item) => item.key !== row_.key))}
										>
											<X size={15} strokeWidth={1.6} aria-hidden="true" />
										</button>
									</li>
								);
							})}
						</ul>
					</section>
				) : models.length === 0 ? null : (
					<section className="prov-section">
						<span className="set-label">{t("providerForm.models")}</span>
						<ul className="prov-catalog">
							{models.map((model) => (
								<li key={model.id} className="prov-catalog-row">
									<span className="prov-catalog-name ell">{model.name}</span>
									<span className="prov-catalog-id mono ell">{model.id}</span>
									<span className="prov-catalog-window mono">{model.contextWindow}</span>
								</li>
							))}
						</ul>
					</section>
				)}

				{error === undefined ? null : <p className="set-row-error">{error}</p>}
			</div>

			<footer className="prov-foot">
				{custom === undefined ? null : isConfirmingDelete ? (
					<span className="prov-foot-danger">
						<button
							type="button"
							className="prov-btn is-danger"
							disabled={isBusy}
							onClick={() => void removeProvider()}
						>
							{t("providers.confirmDelete")}
						</button>
						<button type="button" className="prov-btn" onClick={() => setIsConfirmingDelete(false)}>
							{t("common.cancel")}
						</button>
					</span>
				) : (
					<button type="button" className="prov-btn is-danger" onClick={() => setIsConfirmingDelete(true)}>
						{t("providerForm.deleteProvider")}
					</button>
				)}
				<span className="prov-foot-actions">
					<button type="button" className="prov-btn" onClick={onClose}>
						{t("providerForm.cancel")}
					</button>
					<button type="button" className="set-save" disabled={isBusy} onClick={() => void save()}>
						{isBusy ? t("providerForm.saving") : t("providerForm.save")}
					</button>
				</span>
			</footer>
		</Modal>
	);
}
