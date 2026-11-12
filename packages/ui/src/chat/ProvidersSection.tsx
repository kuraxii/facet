/**
 * 提供方清单。
 *
 * 一份列表放下全部提供方:内置的来自 pi 的目录,用户自己加的来自 models.json 里带模型清单的
 * 条目,后者带「自定义」标记并且多一个编辑入口。凭证、地址、编辑与删除都在同一行里完成,
 * 一个提供方只出现一次。
 */
import type { CustomProviderInfo, ProviderInfo } from "@facet/protocol";
import { useCallback, useEffect, useState } from "react";
import { ProviderForm } from "./ProviderForm.tsx";
import { providerRows } from "./provider-rows.ts";
import type { SettingsDataSource } from "./settings-data-source.ts";

/** 提供方列表与操作。 */
export interface ProvidersSectionProps {
	/** pi 目录里的全部提供方，含自定义 */
	providers: readonly ProviderInfo[] | undefined;
	/** 读取提供方失败的原因 */
	error: string | undefined;
	/** 重新读取提供方 */
	onReload: () => void;
	/** 数据来源 */
	data: SettingsDataSource;
}

/** 一段带重试的失败提示。 */
function StatusNote({ message, onRetry }: { message: string; onRetry: () => void }) {
	return (
		<div className="set-note is-error">
			<span>{message}</span>
			<button type="button" className="set-note-action" onClick={onRetry}>
				重试
			</button>
		</div>
	);
}

export function ProvidersSection({ providers, error, onReload, data }: ProvidersSectionProps) {
	/** 自定义提供方的完整配置，按标识索引 */
	const [customs, setCustoms] = useState<readonly CustomProviderInfo[] | undefined>(undefined);
	/** 展开凭证输入的提供方 */
	const [credentialId, setCredentialId] = useState<string | undefined>(undefined);
	const [key, setKey] = useState("");
	/** 展开地址输入的提供方 */
	const [addressId, setAddressId] = useState<string | undefined>(undefined);
	const [address, setAddress] = useState("");
	/** 正在编辑或新增的自定义提供方；新增时 initial 为空 */
	const [form, setForm] = useState<{ initial: CustomProviderInfo | undefined } | undefined>(undefined);
	/** 正在确认删除的自定义提供方 */
	const [removingId, setRemovingId] = useState<string | undefined>(undefined);
	const [busyId, setBusyId] = useState<string | undefined>(undefined);
	const [failure, setFailure] = useState<{ providerId: string; message: string } | undefined>(undefined);

	const loadCustoms = useCallback(async () => {
		try {
			setCustoms(await data.listCustomProviders());
		} catch (loadError) {
			setFailure({
				providerId: "",
				message: loadError instanceof Error ? loadError.message : String(loadError),
			});
		}
	}, [data]);

	useEffect(() => {
		if (customs !== undefined) {
			return;
		}
		void loadCustoms();
	}, [customs, loadCustoms]);

	/** 记下某个提供方的失败原因，其余行照常可用。 */
	const fail = (providerId: string, error_: unknown): void => {
		setFailure({
			providerId,
			message: error_ instanceof Error ? error_.message : String(error_),
		});
	};

	const saveCredential = async (providerId: string) => {
		setBusyId(providerId);
		setFailure(undefined);
		try {
			await data.saveCredential(providerId, key);
			setCredentialId(undefined);
			setKey("");
			onReload();
		} catch (saveError) {
			fail(providerId, saveError);
		} finally {
			setBusyId(undefined);
		}
	};

	const removeCredential = async (providerId: string) => {
		setBusyId(providerId);
		setFailure(undefined);
		try {
			await data.deleteCredential(providerId);
			onReload();
		} catch (removeError) {
			fail(providerId, removeError);
		} finally {
			setBusyId(undefined);
		}
	};

	/** 保存接口地址，空串表示恢复默认。 */
	const saveAddress = async (providerId: string) => {
		setBusyId(providerId);
		setFailure(undefined);
		try {
			await data.setProviderBaseUrl(providerId, address);
			setAddressId(undefined);
			setAddress("");
			onReload();
		} catch (saveError) {
			fail(providerId, saveError);
		} finally {
			setBusyId(undefined);
		}
	};

	/** 保存自定义提供方：写回配置并让列表跟着更新。 */
	const saveProvider = async (provider: CustomProviderInfo) => {
		setCustoms(await data.saveCustomProvider(provider));
		setForm(undefined);
		onReload();
	};

	const removeProvider = async (providerId: string) => {
		setBusyId(providerId);
		setFailure(undefined);
		try {
			setCustoms(await data.removeCustomProvider(providerId));
			setRemovingId(undefined);
			onReload();
		} catch (removeError) {
			fail(providerId, removeError);
		} finally {
			setBusyId(undefined);
		}
	};

	if (error !== undefined) {
		return (
			<section className="set-section">
				<h2 className="set-section-title">提供方</h2>
				<StatusNote message={`读取提供方失败:${error}`} onRetry={onReload} />
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

	const rows = providerRows(providers, customs ?? []);

	return (
		<section className="set-section">
			<h2 className="set-section-title">提供方</h2>
			<p className="set-hint">
				凭证保存在主机上，界面不回显密钥内容，也不进入日志。带「自定义」标记的提供方来自模型配置，
				可以编辑地址、协议与模型清单。
			</p>

			<ul className="set-list">
				{rows.map(({ provider, custom }) => {
					const isBusy = busyId === provider.id;
					return (
						<li key={provider.id} className="set-row is-block">
							<div className="set-row-head">
								<span className="set-row-name ell">{provider.name}</span>
								{custom === undefined ? null : <span className="set-badge is-custom">自定义</span>}
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
										setCredentialId(credentialId === provider.id ? undefined : provider.id);
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

								{custom === undefined ? (
									provider.authenticated ? (
										<button
											type="button"
											className="set-row-action is-danger"
											disabled={isBusy}
											onClick={() => void removeCredential(provider.id)}
										>
											删除凭证
										</button>
									) : null
								) : (
									<>
										<button
											type="button"
											className="set-row-action"
											onClick={() => {
												setFailure(undefined);
												setForm({ initial: custom });
											}}
										>
											编辑
										</button>
										{removingId === provider.id ? (
											<>
												<button
													type="button"
													className="set-row-action is-danger"
													disabled={isBusy}
													onClick={() => void removeProvider(provider.id)}
												>
													确认删除
												</button>
												<button
													type="button"
													className="set-row-action"
													onClick={() => setRemovingId(undefined)}
												>
													取消
												</button>
											</>
										) : (
											<button
												type="button"
												className="set-row-action is-danger"
												onClick={() => setRemovingId(provider.id)}
											>
												删除
											</button>
										)}
									</>
								)}
							</div>

							{credentialId === provider.id ? (
								<div className="set-row-edit">
									<input
										className="set-input mono"
										type="password"
										value={key}
										onChange={(event) => setKey(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter" && key.trim().length > 0) {
												void saveCredential(provider.id);
											}
										}}
										placeholder="粘贴 API key"
										aria-label={`${provider.name} 的 API key`}
									/>
									<button
										type="button"
										className="set-save"
										disabled={isBusy || key.trim().length === 0}
										onClick={() => void saveCredential(provider.id)}
									>
										{isBusy ? "保存中…" : "保存"}
									</button>
								</div>
							) : null}

							{addressId === provider.id ? (
								<>
									<p className="set-hint mono">
										当前生效:{provider.baseUrl ?? "由提供方决定"}
										{provider.baseUrlOverride === undefined ? "" : "（已覆写）"}
									</p>
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
								</>
							) : null}

							{failure?.providerId === provider.id ? (
								<p className="set-row-error">{failure.message}</p>
							) : null}
						</li>
					);
				})}
				{rows.length === 0 ? <li className="set-row set-row-empty">没有可用的提供方</li> : null}
			</ul>

			{failure?.providerId === "" ? <p className="set-row-error">{failure.message}</p> : null}

			{form === undefined ? (
				<div className="set-actions">
					<button type="button" className="set-reset" onClick={() => setForm({ initial: undefined })}>
						添加自定义提供方
					</button>
				</div>
			) : (
				<ProviderForm initial={form.initial} onSave={saveProvider} onCancel={() => setForm(undefined)} />
			)}
		</section>
	);
}
