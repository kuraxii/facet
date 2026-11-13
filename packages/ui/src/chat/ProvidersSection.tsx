/**
 * 已配置的提供方。
 *
 * 列表里只放已经在用的提供方：凭证配好的内置提供方，以及用户自己加的自定义提供方。没配置的
 * 收在下面的「添加提供商」里，点开是一个可搜索的挑选弹窗。凭证、地址、编辑与删除都在行里完成。
 */
import type { CustomProviderInfo, ProviderInfo } from "@facet/protocol";
import { useState } from "react";
import { ProviderForm } from "./ProviderForm.tsx";
import { ProviderPicker } from "./ProviderPicker.tsx";
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
	/** 自定义提供方的完整配置，由上层读好传进来 */
	customs: readonly CustomProviderInfo[] | undefined;
	/** 自定义提供方变化后回写给上层 */
	onCustomsChange: (customs: readonly CustomProviderInfo[]) => void;
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

export function ProvidersSection({
	providers,
	error,
	onReload,
	data,
	customs,
	onCustomsChange,
}: ProvidersSectionProps) {
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
	/** 添加提供商的挑选弹窗是否打开 */
	const [isPickerOpen, setIsPickerOpen] = useState(false);
	const [busyId, setBusyId] = useState<string | undefined>(undefined);
	const [failure, setFailure] = useState<{ providerId: string; message: string } | undefined>(undefined);

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

	/** 挑选弹窗里存凭证：存完刷新清单，失败让弹窗自己显示。 */
	const saveCredentialInPicker = async (providerId: string, value: string): Promise<void> => {
		await data.saveCredential(providerId, value);
		onReload();
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
		onCustomsChange(await data.saveCustomProvider(provider));
		setForm(undefined);
		onReload();
	};

	const removeProvider = async (providerId: string) => {
		setBusyId(providerId);
		setFailure(undefined);
		try {
			onCustomsChange(await data.removeCustomProvider(providerId));
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
			<>
				<h3 className="set-group-title set-group-title-lg">已配置的提供方</h3>
				<StatusNote message={`读取提供方失败:${error}`} onRetry={onReload} />
			</>
		);
	}
	if (providers === undefined) {
		return (
			<>
				<h3 className="set-group-title set-group-title-lg">已配置的提供方</h3>
				<p className="set-hint">正在读取提供方…</p>
			</>
		);
	}

	// 列表只显示在用的：有凭证或本身就是自定义的
	const rows = providerRows(providers, customs ?? []).filter(
		({ provider, custom }) => provider.authenticated || custom !== undefined,
	);

	return (
		<>
			<h3 className="set-group-title set-group-title-lg">已配置的提供方</h3>

			<ul className="set-list">
				{rows.map(({ provider, custom }) => {
					const isBusy = busyId === provider.id;
					return (
						<li key={provider.id} className="set-row is-block">
							<div className="set-row-head">
								<span className="set-row-name ell">{provider.name}</span>
								{custom === undefined ? (
									<>
										{/* 列表里只有配置好的，所以凭证徽标只表示登录方式，不给「未配置」 */}
										{provider.authenticated ? (
											<span className="set-badge is-on">
												{provider.subscription ? "订阅登录" : "已配置凭证"}
											</span>
										) : null}
										{provider.authSource === undefined ? null : (
											<span className="set-row-meta mono">{provider.authSource}</span>
										)}
									</>
								) : (
									// 自定义提供方的密钥写在模型配置里，凭证状态与来源都由「编辑」那支管
									<span className="set-badge is-custom">自定义</span>
								)}

								{custom === undefined ? (
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
								) : null}
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
				{rows.length === 0 ? <li className="set-row set-row-empty">还没有配置提供方</li> : null}
			</ul>

			{failure?.providerId === "" ? <p className="set-row-error">{failure.message}</p> : null}

			<button type="button" className="set-add-provider" onClick={() => setIsPickerOpen(true)}>
				添加提供商
			</button>

			{form === undefined ? null : (
				<ProviderForm initial={form.initial} onSave={saveProvider} onCancel={() => setForm(undefined)} />
			)}

			{isPickerOpen ? (
				<ProviderPicker
					rows={providerRows(providers, customs ?? [])}
					onSaveCredential={saveCredentialInPicker}
					onCreateCustom={() => {
						setIsPickerOpen(false);
						setForm({ initial: undefined });
					}}
					onClose={() => setIsPickerOpen(false)}
				/>
			) : null}
		</>
	);
}
