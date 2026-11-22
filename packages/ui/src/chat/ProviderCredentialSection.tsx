/**
 * 提供方弹窗里的凭证分区。
 *
 * 两条路：填 API key，或者走账号登录（pi 给了登录按钮文字的那些）。密钥的替换与删除都是
 * 草稿，点弹窗底部的「保存」才落盘；账号登录不等保存，点下去就在主机上跑，凭证由 pi 直接
 * 落盘。
 *
 * 登录期间这一块换成流程给的那几步——浏览器授权、设备码、要回答的一步——问答与取消都即时
 * 发给主机。失败时照样给主机的原话，那是事实内容而不是状态标签。
 */
import type { ProviderLoginState } from "@facet/protocol";
import { type ReactNode, useState } from "react";
import { Button } from "../common/Button.tsx";
import { Input } from "../common/Input.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import type { SettingsDataSource } from "./settings-data-source.ts";

/** 取错误对象里的一句话。 */
function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** 凭证分区的参数。 */
export interface ProviderCredentialSectionProps {
	/** 提供方标识，登录与凭证都按它提交 */
	providerId: string;
	/** 提供方的展示名，写进密钥输入框的可访问名 */
	name: string;
	/** 磁盘上此刻有没有密钥，只用于选占位提示与要不要给删除按钮 */
	hasCredential: boolean;
	/** 能不能走账号登录 */
	canLogin: boolean;
	/** 登录按钮上的文字，缺省「登录」 */
	loginLabel: string;
	/** 弹窗正在提交，按钮都先停掉 */
	isBusy: boolean;
	/** 这个提供方此刻的登录状态 */
	loginState: ProviderLoginState | undefined;
	/** 新密钥，草稿 */
	value: string;
	/** 新密钥变化 */
	onChange: (value: string) => void;
	/** 删除密钥的意图，同样是草稿 */
	isDeletingKey: boolean;
	/** 按下或撤回「删除密钥」 */
	onToggleDelete: () => void;
	/** 自定义提供方：自动焦点给名字那一格，密钥框不抢 */
	isCustom: boolean;
	/** 数据来源，登录流程的问答与取消走它 */
	data: SettingsDataSource;
	/** 登录启动失败时把原因交给弹窗统一显示 */
	onError: (message: string) => void;
}

/** 凭证分区。 */
export function ProviderCredentialSection({
	providerId,
	name,
	hasCredential,
	canLogin,
	loginLabel,
	isBusy,
	loginState,
	value,
	onChange,
	isDeletingKey,
	onToggleDelete,
	isCustom,
	data,
	onError,
}: ProviderCredentialSectionProps): ReactNode {
	const { t } = useI18n();
	const isRunning = loginState !== undefined && loginState.status === "running";
	return (
		<section className="prov-section">
			<div className="prov-section-head">
				<span className="set-label">{t("providerForm.credential")}</span>
				{canLogin ? (
					<span className="prov-section-actions">
						<Button
							variant="ghost"
							size="sm"
							className="prov-tone-accent"
							disabled={isBusy || isRunning}
							onClick={() => {
								void data.startProviderLogin(providerId, "oauth").catch((error: unknown) => {
									onError(messageOf(error));
								});
							}}
						>
							{loginLabel}
						</Button>
					</span>
				) : null}
			</div>
			{isRunning && loginState !== undefined ? (
				<LoginFlow
					state={loginState}
					onRespond={(promptId, answer) => {
						void data.respondProviderLogin(loginState.loginId, promptId, answer);
					}}
					onCancel={() => {
						void data.cancelProviderLogin(loginState.loginId);
					}}
				/>
			) : (
				<div className="prov-cred">
					<Input
						size="md"
						type="password"
						value={value}
						disabled={isDeletingKey}
						onChange={(event) => onChange(event.target.value)}
						placeholder={
							hasCredential && !isDeletingKey ? t("providers.apiKeyUpdate") : t("providers.apiKeyMissing")
						}
						aria-label={t("providers.apiKeyLabel", { name })}
						{...(isCustom ? {} : { "data-autofocus": true })}
					/>
					{hasCredential ? (
						<Button
							variant="danger"
							size="sm"
							armed={isDeletingKey}
							aria-pressed={isDeletingKey}
							onClick={onToggleDelete}
						>
							{isDeletingKey ? t("providers.cancelDeleteCredential") : t("providers.deleteCredential")}
						</Button>
					) : null}
				</div>
			)}
			{loginState?.status === "failed" && loginState.message !== undefined ? (
				<p className="prov-error">{loginState.message}</p>
			) : null}
		</section>
	);
}

/**
 * 登录流程里要用户看与要用户答的那一块。
 *
 * 只渲染主机给的东西：设备码、授权地址、要回答的一步。进度与终局由样式表达，不写状态文字。
 */
function LoginFlow({
	state,
	onRespond,
	onCancel,
}: {
	state: ProviderLoginState;
	onRespond: (promptId: string, value: string | null) => void;
	onCancel: () => void;
}): ReactNode {
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
					<Button
						variant="ghost"
						size="sm"
						className="prov-tone-accent"
						onClick={() => window.open(state.deviceCode?.verificationUri, "_blank", "noopener")}
					>
						{t("providerForm.loginOpen")}
					</Button>
				</div>
			) : null}

			{state.authUrl !== undefined ? (
				<Button
					variant="secondary"
					size="sm"
					onClick={() => window.open(state.authUrl?.url, "_blank", "noopener")}
				>
					{t("providerForm.loginOpen")}
				</Button>
			) : null}

			{prompt !== undefined && prompt.kind === "select" ? (
				<div className="prov-login-options">
					{(prompt.options ?? []).map((option) => (
						<Button key={option.id} variant="secondary" size="sm" onClick={() => submit(option.id)}>
							{option.label}
						</Button>
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
						<Input
							id={prompt.promptId}
							size="md"
							type={prompt.kind === "secret" ? "password" : "text"}
							value={answer}
							{...{ "data-autofocus": true }}
							onChange={(event) => setAnswer(event.target.value)}
							placeholder={prompt.placeholder}
						/>
						<Button type="submit" variant="secondary" size="sm" disabled={answer.trim().length === 0}>
							{t("providerForm.loginContinue")}
						</Button>
					</div>
				</form>
			) : null}

			<Button variant="ghost" size="sm" className="prov-tone-danger" onClick={onCancel}>
				{t("providerForm.loginCancel")}
			</Button>
		</div>
	);
}
