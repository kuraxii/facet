/**
 * 代理后端与外部 ACP Agent 管理设置页。
 *
 * 展示 Pi 与已登记的 ACP 后端（含内置 Antigravity 探测状态与终端认证指引），
 * 并支持增删改自定义 ACP CLI（命令、参数、启用态与登录指引）。
 */
import type { AcpBackendProfile, BackendAvailability } from "@facet/protocol";
import { Plus } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Badge } from "../common/Badge.tsx";
import { Button } from "../common/Button.tsx";
import { Input } from "../common/Input.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { parseCommandArgs } from "./backend-model.ts";
import type { SettingsDataSource } from "./settings-data-source.ts";
import { SettingsGroup, SettingsRow, StatusNote } from "./settings-layout.tsx";

interface ProfileDraft {
	id: string;
	name: string;
	command: string;
	argsText: string;
	loginHint: string;
	enabled: boolean;
	builtIn: boolean;
	isNew: boolean;
}

function emptyDraft(): ProfileDraft {
	return {
		id: "",
		name: "",
		command: "",
		argsText: "",
		loginHint: "",
		enabled: true,
		builtIn: false,
		isNew: true,
	};
}

function draftFromProfile(profile: AcpBackendProfile): ProfileDraft {
	return {
		id: profile.id,
		name: profile.name,
		command: profile.command,
		argsText: profile.args.join(" "),
		loginHint: profile.loginHint ?? "",
		enabled: profile.enabled,
		builtIn: Boolean(profile.builtIn),
		isNew: false,
	};
}

export interface SettingsAgentsSectionProps {
	data: SettingsDataSource;
}

export function SettingsAgentsSection({ data }: SettingsAgentsSectionProps): React.JSX.Element {
	const { t } = useI18n();
	const [backends, setBackends] = useState<readonly BackendAvailability[] | undefined>(undefined);
	const [profiles, setProfiles] = useState<readonly AcpBackendProfile[]>([]);
	const [error, setError] = useState<string | undefined>(undefined);
	const [probingId, setProbingId] = useState<string | undefined>(undefined);
	const [editing, setEditing] = useState<ProfileDraft | undefined>(undefined);
	const [saving, setSaving] = useState(false);

	const load = useCallback(async () => {
		if (data.loadBackends === undefined) {
			return;
		}
		setError(undefined);
		try {
			const res = await data.loadBackends();
			setBackends(res.backends);
			setProfiles(res.profiles);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}, [data]);

	useEffect(() => {
		void load();
	}, [load]);

	const handleProbe = async (backendId: string): Promise<void> => {
		if (data.probeBackend === undefined) {
			return;
		}
		setProbingId(backendId);
		try {
			const result = await data.probeBackend(backendId);
			setBackends((prev) => prev?.map((item) => (item.id === backendId ? result : item)));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setProbingId(undefined);
		}
	};

	const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
		event.preventDefault();
		if (editing === undefined || data.saveAcpBackend === undefined) {
			return;
		}
		setSaving(true);
		setError(undefined);
		try {
			const res = await data.saveAcpBackend({
				id: editing.id.trim(),
				name: editing.name.trim(),
				command: editing.command.trim(),
				args: parseCommandArgs(editing.argsText),
				enabled: editing.enabled,
				...(editing.builtIn ? { builtIn: true } : {}),
				...(editing.loginHint.trim().length > 0 ? { loginHint: editing.loginHint.trim() } : {}),
			});
			setBackends(res.backends);
			setProfiles(res.profiles);
			setEditing(undefined);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	const handleRemove = async (backendId: string): Promise<void> => {
		if (data.removeAcpBackend === undefined) {
			return;
		}
		setError(undefined);
		try {
			const res = await data.removeAcpBackend(backendId);
			setBackends(res.backends);
			setProfiles(res.profiles);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	};

	return (
		<>
			{error !== undefined ? (
				<StatusNote message={t("settings.agentsPage.readFailed", { error })} onRetry={() => void load()} />
			) : null}

			<SettingsGroup label={t("settings.agentsPage.available")}>
				{backends === undefined ? (
					<p className="set-hint">{t("settings.agentsPage.loading")}</p>
				) : (
					backends.map((backend) => {
						const profile = profiles.find((p) => p.id === backend.id);
						const badgeLabel = !backend.enabled
							? t("settings.agentsPage.disabled")
							: backend.available
								? t("settings.agentsPage.ready")
								: t("settings.agentsPage.unavailable");
						return (
							<SettingsRow key={backend.id} title={backend.name} isStacked>
								<div className="set-item-control">
									<Badge>{badgeLabel}</Badge>
									{backend.kind === "acp" && data.probeBackend !== undefined ? (
										<Button
											size="sm"
											disabled={probingId === backend.id}
											onClick={() => void handleProbe(backend.id)}
										>
											{probingId === backend.id
												? t("settings.agentsPage.probing")
												: t("settings.agentsPage.probe")}
										</Button>
									) : null}
									{profile !== undefined && data.saveAcpBackend !== undefined ? (
										<Button size="sm" onClick={() => setEditing(draftFromProfile(profile))}>
											{t("settings.agentsPage.edit")}
										</Button>
									) : null}
									{profile !== undefined && !profile.builtIn && data.removeAcpBackend !== undefined ? (
										<Button size="sm" onClick={() => void handleRemove(profile.id)}>
											{t("settings.agentsPage.remove")}
										</Button>
									) : null}
								</div>
								{backend.binaryPath ? <p className="set-hint mono">{backend.binaryPath}</p> : null}
								{backend.issue ? <p className="set-hint">{backend.issue}</p> : null}
								{backend.loginHint ? (
									<p className="set-hint mono">
										{t("settings.agentsPage.loginHint", { command: backend.loginHint })}
									</p>
								) : null}
							</SettingsRow>
						);
					})
				)}
			</SettingsGroup>

			{data.saveAcpBackend !== undefined ? (
				<SettingsGroup>
					{editing === undefined ? (
						<SettingsRow title={t("settings.agentsPage.addCustom")}>
							<Button size="sm" onClick={() => setEditing(emptyDraft())}>
								<Plus size={ICON_SIZE.sm} />
								{t("settings.agentsPage.addCustom")}
							</Button>
						</SettingsRow>
					) : (
						<form onSubmit={(event) => void handleSubmit(event)}>
							<SettingsRow title={t("settings.agentsPage.idLabel")}>
								<Input
									size="md"
									disabled={!editing.isNew}
									value={editing.id}
									onChange={(e) => setEditing({ ...editing, id: e.target.value })}
								/>
							</SettingsRow>
							<SettingsRow title={t("settings.agentsPage.nameLabel")}>
								<Input
									size="md"
									value={editing.name}
									onChange={(e) => setEditing({ ...editing, name: e.target.value })}
								/>
							</SettingsRow>
							<SettingsRow title={t("settings.agentsPage.commandLabel")}>
								<Input
									size="md"
									value={editing.command}
									onChange={(e) => setEditing({ ...editing, command: e.target.value })}
								/>
							</SettingsRow>
							<SettingsRow title={t("settings.agentsPage.argsLabel")}>
								<Input
									size="md"
									value={editing.argsText}
									onChange={(e) => setEditing({ ...editing, argsText: e.target.value })}
								/>
							</SettingsRow>
							<SettingsRow title={t("settings.agentsPage.loginHintLabel")}>
								<Input
									size="md"
									value={editing.loginHint}
									onChange={(e) => setEditing({ ...editing, loginHint: e.target.value })}
								/>
							</SettingsRow>
							<SettingsRow title={t("settings.agentsPage.enabledLabel")}>
								<input
									type="checkbox"
									checked={editing.enabled}
									onChange={(e) => setEditing({ ...editing, enabled: e.target.checked })}
								/>
							</SettingsRow>
							<SettingsRow title="">
								<div className="set-item-control">
									<Button size="sm" type="button" onClick={() => setEditing(undefined)}>
										{t("settings.agentsPage.cancel")}
									</Button>
									<Button size="sm" variant="primary" type="submit" disabled={saving}>
										{t("settings.agentsPage.save")}
									</Button>
								</div>
							</SettingsRow>
						</form>
					)}
				</SettingsGroup>
			) : null}
		</>
	);
}
