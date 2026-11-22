/**
 * 提供方编辑弹窗。
 *
 * 一个提供方要改的东西都收在这里：密钥，自定义提供方还有地址、协议与模型清单。内置提供方的
 * 名字、地址、协议与模型全由 pi 的目录给定，这里只能改密钥——要改地址就得自己建一个自定义
 * 提供方。这一页是份草稿：名字、地址、协议、模型、密钥的替换与删除都只改本地状态，点弹窗底部
 * 的「保存」才落盘，点「取消」全部丢掉。新建自定义提供方时标识按名字自动推出。
 * 凭证与清单分别写在两处配置里，所以保存时按「先建提供方、再写凭证」的顺序提交。
 *
 * 模型清单、凭证分区各自一个文件；这里只管草稿状态、保存与删除。
 */
import type { CustomModelInfo, CustomProviderInfo, ModelInfo } from "@facet/protocol";
import { X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "../common/Button.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { Input } from "../common/Input.tsx";
import { Select } from "../common/select.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Modal } from "../modal.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ProviderCredentialSection } from "./ProviderCredentialSection.tsx";
import { ProviderModelTable } from "./ProviderModelTable.tsx";
import { API_OPTIONS, apiOptionLabel } from "./provider-api.ts";
import { providerDraftIssue } from "./provider-draft.ts";
import { type ModelRow, modelRow, rewriteModelRow } from "./provider-model-row.ts";
import type { ProviderRow } from "./provider-rows.ts";
import type { SettingsDataSource } from "./settings-data-source.ts";

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
	 * 拉回来的清单已经在主机侧按模型信息库补过展示名、上下文窗口、最大输出与思考档位，所以同一个
	 * 标识的行整行按它重写；表里没有的补在后面，没填标识的空行原样留着。
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
				const byId = new Map(fetched.models.map((model) => [model.id.trim(), model]));
				const next = current.map((item) => {
					const hit = byId.get(item.model.id.trim());
					if (hit === undefined) {
						return item;
					}
					byId.delete(hit.id.trim());
					return rewriteModelRow(item, hit);
				});
				const added = [...byId.values()].map((model) => modelRow({ ...model }));
				return [...next, ...added];
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
				const provider: CustomProviderInfo = {
					id: shownId.trim(),
					name: name.trim(),
					baseUrl: baseUrl.trim(),
					api,
					models: rows.map((item) => ({ ...item.model, id: item.model.id.trim() })),
				};
				await data.saveCustomProvider(provider);
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
	const shownName = custom?.name ?? provider?.name ?? "";

	return (
		<Modal open onClose={onClose} label={title} className="is-provider">
			<header className="prov-head">
				<h2 className="dialog-title">{title}</h2>
				<IconButton
					variant="ghost"
					size="sm"
					className="dialog-close"
					aria-label={t("common.close")}
					onClick={onClose}
				>
					<X size={ICON_SIZE.lg} />
				</IconButton>
			</header>

			<div className="prov-body">
				{isCustom ? (
					<div className="prov-pair">
						<label className="set-field">
							<span className="set-label">{t("providerForm.name")}</span>
							<Input
								size="md"
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
							<Input
								size="md"
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
						<Input
							size="md"
							value={baseUrl}
							onChange={(event) => setBaseUrl(event.target.value)}
							placeholder="https://gateway.example.com/v1"
							aria-label={t("providerForm.baseUrl")}
						/>
					</label>
				) : null}

				{isCustom ? (
					// 下拉自己带可访问名，这层只做排版；标签包住一个自定义组件不算关联，换 div
					<div className="set-field">
						<span className="set-label">{t("providerForm.api")}</span>
						<Select
							value={api}
							options={API_OPTIONS.map((option) => ({
								value: option.value,
								label: apiOptionLabel(option, t),
							}))}
							onChange={setApi}
							ariaLabel={t("providerForm.api")}
						/>
					</div>
				) : null}

				<ProviderCredentialSection
					providerId={shownId}
					name={shownName}
					hasCredential={hasCredential}
					canLogin={canLogin}
					loginLabel={loginLabel}
					isBusy={isBusy}
					loginState={loginState}
					value={key}
					onChange={setKey}
					isDeletingKey={isDeletingKey}
					onToggleDelete={() => {
						setKey("");
						setIsDeletingKey(!isDeletingKey);
					}}
					isCustom={isCustom}
					data={data}
					onError={setError}
				/>

				{isCustom ? (
					<ProviderModelTable
						rows={rows}
						isFetching={isFetching}
						canFetch={baseUrl.trim().length > 0}
						onFetch={() => void fetchModels()}
						onAdd={() => setRows((current) => [...current, modelRow()])}
						onPatch={patchModel}
						onRemove={(key_) => setRows((current) => current.filter((item) => item.key !== key_))}
					/>
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
						<Button variant="danger" size="sm" disabled={isBusy} onClick={() => void removeProvider()}>
							{t("providers.confirmDelete")}
						</Button>
						<Button variant="secondary" size="sm" onClick={() => setIsConfirmingDelete(false)}>
							{t("common.cancel")}
						</Button>
					</span>
				) : (
					<Button variant="danger" size="sm" onClick={() => setIsConfirmingDelete(true)}>
						{t("providerForm.deleteProvider")}
					</Button>
				)}
				<span className="prov-foot-actions">
					<Button variant="secondary" size="sm" onClick={onClose}>
						{t("providerForm.cancel")}
					</Button>
					<Button variant="primary" size="md" disabled={isBusy} onClick={() => void save()}>
						{isBusy ? t("providerForm.saving") : t("providerForm.save")}
					</Button>
				</span>
			</footer>
		</Modal>
	);
}
