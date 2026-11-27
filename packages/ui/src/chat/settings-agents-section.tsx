/**
 * Agent 与 ACP 账号认证设置页（极简风格）。
 *
 * 展示内置支持的 Agent（Pi 与 Antigravity 等），支持探测可用性与页面内发起 OAuth 登录，
 * 不提供自定义添加 ACP 的表单（ACP 均由代码内置维护）。
 */
import type { AgentAvailability } from "@facet/protocol";
import { Copy } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Badge } from "../common/Badge.tsx";
import { Button } from "../common/Button.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { Input } from "../common/Input.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { BackendIcon } from "./AgentsIcon.tsx";
import type { SettingsDataSource } from "./settings-data-source.ts";
import { SettingsGroup, SettingsRow, StatusNote } from "./settings-layout.tsx";

interface ActiveLoginState {
	readonly agentId: string;
	readonly loginId: string;
	readonly authUrl?: string;
	code: string;
	submitting: boolean;
}

export interface SettingsAgentsSectionProps {
	data: SettingsDataSource;
}

export function SettingsAgentsSection({ data }: SettingsAgentsSectionProps): React.JSX.Element {
	const { t } = useI18n();
	const [agents, setBackends] = useState<readonly AgentAvailability[] | undefined>(undefined);
	const [error, setError] = useState<string | undefined>(undefined);
	const [probingId, setProbingId] = useState<string | undefined>(undefined);
	const [startingLoginId, setStartingLoginId] = useState<string | undefined>(undefined);
	const [login, setLogin] = useState<ActiveLoginState | undefined>(undefined);

	const load = useCallback(async () => {
		if (data.loadAgents === undefined) {
			return;
		}
		setError(undefined);
		try {
			const res = await data.loadAgents();
			setBackends(res.agents);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [data]);

	useEffect(() => {
		void load();
	}, [load]);

	const handleProbe = async (agentId: string): Promise<void> => {
		if (data.probeAgent === undefined) {
			return;
		}
		setProbingId(agentId);
		setError(undefined);
		try {
			const result = await data.probeAgent(agentId);
			setBackends((prev) => prev?.map((item) => (item.id === agentId ? result : item)));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setProbingId(undefined);
		}
	};

	const handleStartLogin = async (agentId: string): Promise<void> => {
		if (data.acpLoginStart === undefined) {
			return;
		}
		setStartingLoginId(agentId);
		setError(undefined);
		try {
			const res = await data.acpLoginStart(agentId);
			setLogin({
				agentId,
				loginId: res.loginId,
				...(res.authUrl === undefined ? {} : { authUrl: res.authUrl }),
				code: "",
				submitting: false,
			});
			if (res.authUrl !== undefined) {
				window.open(res.authUrl, "_blank", "noopener");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setStartingLoginId(undefined);
		}
	};

	const handleSubmitLogin = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		if (login === undefined || data.acpLoginSubmit === undefined || login.code.trim().length === 0) {
			return;
		}
		const current = login;
		setLogin({ ...current, submitting: true });
		setError(undefined);
		try {
			const updated = await data.acpLoginSubmit(current.loginId, current.code);
			setBackends((prev) => prev?.map((item) => (item.id === current.agentId ? updated : item)));
			setLogin(undefined);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
			setLogin(undefined);
		}
	};

	const handleCancelLogin = async (): Promise<void> => {
		if (login === undefined) {
			return;
		}
		const loginId = login.loginId;
		setLogin(undefined);
		if (data.acpLoginCancel !== undefined) {
			await data.acpLoginCancel(loginId).catch(() => undefined);
		}
	};

	return (
		<>
			{error !== undefined ? (
				<StatusNote message={t("settings.agentsPage.readFailed", { error })} onRetry={() => void load()} />
			) : null}

			<SettingsGroup label={t("settings.agentsPage.available")}>
				{agents === undefined ? (
					<p className="set-hint">{t("settings.agentsPage.loading")}</p>
				) : (
					agents.map((agent) => {
						const isLoggingIn = login?.agentId === agent.id;
						const badgeLabel = !agent.enabled
							? t("settings.agentsPage.disabled")
							: agent.available
								? t("settings.agentsPage.ready")
								: t("settings.agentsPage.unavailable");
						return (
							<SettingsRow key={agent.id} title={agent.name} isStacked>
								<div className="set-item-control">
									<BackendIcon agentId={agent.id} size={ICON_SIZE.md} />
									<Badge>{badgeLabel}</Badge>
									{agent.kind === "acp" && data.acpLoginStart !== undefined && !isLoggingIn ? (
										<Button
											size="sm"
											disabled={startingLoginId === agent.id}
											onClick={() => void handleStartLogin(agent.id)}
										>
											{agent.available
												? t("settings.agentsPage.changeAccount")
												: t("settings.agentsPage.signIn")}
										</Button>
									) : null}
									{agent.kind === "acp" && data.probeAgent !== undefined && !isLoggingIn ? (
										<Button
											size="sm"
											disabled={probingId === agent.id}
											onClick={() => void handleProbe(agent.id)}
										>
											{probingId === agent.id
												? t("settings.agentsPage.probing")
												: t("settings.agentsPage.probe")}
										</Button>
									) : null}
									{isLoggingIn ? (
										<>
											{login.authUrl !== undefined ? (
												<>
													<Button size="sm" onClick={() => window.open(login.authUrl, "_blank", "noopener")}>
														{t("settings.agentsPage.openBrowser")}
													</Button>
													<IconButton
														size="sm"
														aria-label={t("settings.agentsPage.copy")}
														onClick={() => void navigator.clipboard?.writeText(login.authUrl ?? "")}
													>
														<Copy size={ICON_SIZE.sm} />
													</IconButton>
												</>
											) : null}
											<Button size="sm" onClick={() => void handleCancelLogin()}>
												{t("settings.agentsPage.cancel")}
											</Button>
										</>
									) : null}
								</div>
								{isLoggingIn ? (
									<form onSubmit={(event) => void handleSubmitLogin(event)}>
										<p className="set-hint">{t("settings.agentsPage.codeLabel")}</p>
										<div className="set-item-control">
											<Input
												size="md"
												value={login.code}
												onChange={(e) => setLogin({ ...login, code: e.target.value })}
											/>
											<Button
												size="sm"
												type="submit"
												disabled={login.submitting || login.code.trim().length === 0}
											>
												{t("settings.agentsPage.connect")}
											</Button>
										</div>
									</form>
								) : null}
								{!isLoggingIn && agent.issue ? <p className="set-hint">{agent.issue}</p> : null}
							</SettingsRow>
						);
					})
				)}
			</SettingsGroup>
		</>
	);
}
