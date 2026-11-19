/**
 * 提供方编辑弹窗。
 *
 * 一个提供方要改的东西都收在这里：密钥，自定义提供方还有地址、协议与模型清单。内置提供方的
 * 名字、地址、协议与模型全由 pi 的目录给定，这里只能改密钥——要改地址就得自己建一个自定义
 * 提供方。这一页是份草稿：名字、地址、协议、模型、密钥的替换与删除都只改本地状态，点弹窗底部
 * 的「保存」才落盘，点「取消」全部丢掉。密钥在一个输入框里改，已配置的另给一个删除开关（同样
 * 要等保存才生效）。新建自定义提供方时标识按名字自动推出。
 * 凭证与清单分别写在两处配置里，所以保存时按「先建提供方、再写凭证」的顺序提交。
 *
 * 能走账号登录的提供方（pi 给了登录按钮文字的那些）另有一条登录通路：它不等「保存」，点下去
 * 就在主机上跑，凭证由 pi 直接落盘，完成后关掉弹窗。登录期间这块区域换成流程给的那几步——
 * 浏览器授权、设备码、要回答的一步——问答与取消都即时发给主机。
 */
import type { CustomModelInfo, ModelInfo, ProviderLoginState } from "@facet/protocol";
import { Plus, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Modal } from "../modal.tsx";
import { API_OPTIONS, apiOptionLabel } from "./provider-api.ts";
import { providerDraftIssue } from "./provider-draft.ts";
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
	const [baseUrl, setBaseUrl] = useState(custom?.baseUrl ?? "");
	const [api, setApi] = useState(custom?.api ?? API_OPTIONS[0]?.value ?? "openai-completions");
	const [rows, setRows] = useState<ModelRow[]>(() =>
		custom === undefined ? [modelRow()] : custom.models.map((model) => modelRow(model)),
	);

	/** 磁盘上此刻有没有密钥，只用于选占位提示与要不要给删除按钮 */
	const hasCredential = provider?.authenticated === true;
	/**
	 * 能不能走账号登录，以及按钮上写什么。
	 *
	 * 按钮文字优先用 pi 的官方说法（例如「Sign in with ChatGPT」），没有就用「登录」；不能登录的
	 * 提供方只留密钥这一条路。
	 */
	const canLogin = !isNew && provider?.canLogin === true;
	const loginLabel = provider?.loginLabel ?? t("providerForm.login");
	/** 输入的新密钥，草稿：点「保存」才落盘 */
	const [key, setKey] = useState("");
	/** 删除密钥的意图，同样是草稿，点「保存」才删 */
	const [isDeletingKey, setIsDeletingKey] = useState(false);
	/** 正在从上游拉模型 */
	const [isFetching, setIsFetching] = useState(false);
	const [isBusy, setIsBusy] = useState(false);
	const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
	const [error, setError] = useState<string | undefined>(undefined);

	const shownId = isNew ? id : providerId;
	/**
	 * 这个提供方此刻的登录状态。
	 *
	 * 状态由主机推过来，多个端看到的同一条；这里只读，不等「保存」。
	 */
	const loginState = useSyncExternalStore(data.subscribeProviderLogin, () =>
		shownId.length === 0 ? undefined : data.providerLogin(shownId),
	);
	/** 登录成功：凭证已经落盘，重取提供方清单并关掉弹窗 */
	const loginStatus = loginState?.status;
	const finished = loginStatus === "done";
	useEffect(() => {
		if (finished) {
			onChanged();
			onClose();
		}
	}, [finished, onChanged, onClose]);

	/**
	 * 从上游的 `/v1/models` 拉模型清单填进模型表。
	 *
	 * 有的网关要密钥才给列表：带上密钥框里刚填的那个，没填就由主机按这个提供方已有的认证去解析。
	 * 已经填了标识的行原样保留（用户可能改过名字与窗口），只把还没有的补在后面。
	 */
	const fetchModels = async (): Promise<void> => {
		setIsFetching(true);
		setError(undefined);
		try {
			const fetched = await data.fetchProviderModels({
				baseUrl: baseUrl.trim(),
				...(isNew ? {} : { providerId: shownId }),
				...(key.trim().length > 0 ? { apiKey: key.trim() } : {}),
				api,
			});
			// 裸站点根被补成 /v1 之后与用户填的不同，回填给他看（仍是草稿，保存才落盘）
			if (fetched.baseUrl.length > 0 && fetched.baseUrl !== baseUrl.trim()) {
				setBaseUrl(fetched.baseUrl);
			}
			if (fetched.models.length === 0) {
				setError(t("providerForm.fetchModelsEmpty"));
				return;
			}
			setRows((current) => {
				const kept = current.filter((item) => item.model.id.trim().length > 0);
				// 标识完全相同才跳过：已有的行原样保留，展示名、窗口等一个字都不动；大小写不同算新模型
				const known = new Set(kept.map((item) => item.model.id.trim()));
				const added = fetched.models
					.filter((model) => !known.has(model.id.trim()))
					.map((model) => modelRow({ ...model }));
				return [...kept, ...added];
			});
		} catch (fetchError) {
			setError(messageOf(fetchError));
		} finally {
			setIsFetching(false);
		}
	};

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
		const issue = providerDraftIssue({
			id: shownId,
			name,
			baseUrl,
			models: rows.map((item) => item.model),
		});
		return issue === undefined ? undefined : t(issue);
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
			}
			// 密钥与提供方配置分两处存放：配置走上面那一步，密钥的两种改动都在这里落盘
			if (isDeletingKey) {
				await data.deleteCredential(shownId);
			} else if (key.trim().length > 0) {
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

				{isCustom ? (
					<label className="set-field">
						<span className="set-label">{t("providerForm.baseUrl")}</span>
						<input
							className="set-input mono"
							value={baseUrl}
							onChange={(event) => setBaseUrl(event.target.value)}
							placeholder="https://gateway.example.com/v1"
							aria-label={t("providerForm.baseUrl")}
						/>
					</label>
				) : null}

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
					<div className="prov-section-head">
						<span className="set-label">{t("providerForm.credential")}</span>
						{canLogin ? (
							<span className="prov-section-actions">
								<button
									type="button"
									className="prov-btn is-ghost"
									disabled={isBusy || (loginState !== undefined && loginState.status === "running")}
									onClick={() => {
										setError(undefined);
										void data.startProviderLogin(shownId, "oauth").catch((startError: unknown) => {
											setError(messageOf(startError));
										});
									}}
								>
									{loginLabel}
								</button>
							</span>
						) : null}
					</div>
					{loginState !== undefined && loginState.status === "running" ? (
						<LoginFlow
							state={loginState}
							onRespond={(promptId, value) => {
								void data.respondProviderLogin(loginState.loginId, promptId, value);
							}}
							onCancel={() => {
								void data.cancelProviderLogin(loginState.loginId);
							}}
						/>
					) : (
						<div className="prov-cred">
							<input
								className="set-input mono"
								type="password"
								value={key}
								disabled={isDeletingKey}
								onChange={(event) => setKey(event.target.value)}
								placeholder={
									hasCredential && !isDeletingKey ? t("providers.apiKeyUpdate") : t("providers.apiKeyMissing")
								}
								aria-label={t("providers.apiKeyLabel", { name: custom?.name ?? provider?.name ?? "" })}
								{...(isCustom ? {} : { "data-autofocus": true })}
							/>
							{hasCredential ? (
								<button
									type="button"
									className={isDeletingKey ? "prov-btn is-danger is-armed" : "prov-btn is-danger"}
									aria-pressed={isDeletingKey}
									onClick={() => {
										setKey("");
										setIsDeletingKey(!isDeletingKey);
									}}
								>
									{isDeletingKey ? t("providers.cancelDeleteCredential") : t("providers.deleteCredential")}
								</button>
							) : null}
						</div>
					)}
					{loginState?.status === "failed" && loginState.message !== undefined ? (
						<p className="prov-error">{loginState.message}</p>
					) : null}
				</section>

				{isCustom ? (
					<section className="prov-section">
						<div className="prov-section-head">
							<span className="set-label">{t("providerForm.models")}</span>
							<span className="prov-section-actions">
								<button
									type="button"
									className="prov-btn is-ghost"
									disabled={isFetching || baseUrl.trim().length === 0}
									onClick={() => void fetchModels()}
								>
									{t("providerForm.fetchModels")}
								</button>
								<button
									type="button"
									className="prov-btn is-ghost"
									onClick={() => setRows((current) => [...current, modelRow()])}
								>
									<Plus size={13} strokeWidth={2} aria-hidden="true" />
									{t("providerForm.addModel")}
								</button>
							</span>
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

/**
 * 登录流程里要用户看与要用户答的那一块。
 *
 * 只渲染主机给的东西：设备码、授权地址、要回答的一步。进度与终局由样式表达，不写状态文字；
 * 失败时照样给主机原话，那是事实内容而不是标签。
 */
function LoginFlow({
	state,
	onRespond,
	onCancel,
}: {
	state: ProviderLoginState;
	onRespond: (promptId: string, value: string | null) => void;
	onCancel: () => void;
}): React.JSX.Element {
	const { t } = useI18n();
	const [answer, setAnswer] = useState("");
	const prompt = state.prompt;
	const submit = (value: string): void => {
		if (prompt === undefined || value.trim().length === 0) {
			return;
		}
		setAnswer("");
		onRespond(prompt.promptId, value.trim());
	};

	return (
		<div className="prov-login">
			{state.deviceCode !== undefined ? (
				<div className="prov-login-code">
					<span className="mono">{state.deviceCode.userCode}</span>
					<button
						type="button"
						className="prov-btn is-ghost"
						onClick={() => window.open(state.deviceCode?.verificationUri, "_blank", "noopener")}
					>
						{t("providerForm.loginOpen")}
					</button>
				</div>
			) : null}

			{state.authUrl !== undefined ? (
				<button
					type="button"
					className="prov-btn"
					onClick={() => window.open(state.authUrl?.url, "_blank", "noopener")}
				>
					{t("providerForm.loginOpen")}
				</button>
			) : null}

			{prompt !== undefined && prompt.kind === "select" ? (
				<div className="prov-login-options">
					{(prompt.options ?? []).map((option) => (
						<button key={option.id} type="button" className="prov-btn" onClick={() => submit(option.id)}>
							{option.label}
						</button>
					))}
				</div>
			) : null}

			{prompt !== undefined && prompt.kind !== "select" ? (
				<form
					className="prov-login-answer"
					onSubmit={(event) => {
						event.preventDefault();
						submit(answer);
					}}
				>
					{/* 题目由登录流程给，单独一行；输入框只留占位，免得长句子被截断 */}
					<label className="prov-login-label" htmlFor={prompt.promptId}>
						{prompt.message}
					</label>
					<div className="prov-login-field">
						<input
							id={prompt.promptId}
							className="set-input mono"
							type={prompt.kind === "secret" ? "password" : "text"}
							value={answer}
							{...{ "data-autofocus": true }}
							onChange={(event) => setAnswer(event.target.value)}
							placeholder={prompt.placeholder}
						/>
						<button type="submit" className="prov-btn" disabled={answer.trim().length === 0}>
							{t("providerForm.loginContinue")}
						</button>
					</div>
				</form>
			) : null}

			<button type="button" className="prov-btn is-danger is-ghost" onClick={onCancel}>
				{t("providerForm.loginCancel")}
			</button>
		</div>
	);
}
