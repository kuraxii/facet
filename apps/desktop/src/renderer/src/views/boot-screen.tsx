/**
 * 连不上主机与连接中的两屏。
 *
 * 只摆事实：失败原因、当前端点与可选的主机。重试与换主机都交给连接域。
 */

import { endpointLabel, SshPasswordDialog, useI18n } from "@facet/ui";
import type { ReactNode } from "react";
import { AppFrame } from "../app-frame.tsx";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import { LOCAL_TARGET } from "../host-connection.ts";

export interface BootScreenProps {
	/** 连接域 */
	host: HostConnection;
}

export function BootScreen({ host }: BootScreenProps): ReactNode {
	const { t } = useI18n();
	const passwordDialog =
		host.sshAuthPrompt === undefined ? null : (
			<SshPasswordDialog
				host={host.sshAuthPrompt.host}
				isRetry={host.sshAuthPrompt.isRetry}
				onSubmit={host.submitSshPassword}
				onCancel={host.cancelSshAuth}
			/>
		);
	if (host.phase === "failed") {
		return (
			<AppFrame>
				<main className="boot">
					<h1>{t("app.connectFailed")}</h1>
					<p>{host.failure}</p>
					<p>{host.endpoint}</p>
					<div className="boot-hosts">
						<button
							type="button"
							className="boot-host"
							onClick={() => void host.selectHost(LOCAL_TARGET)}
							disabled={host.endpoint === LOCAL_TARGET}
						>
							{t("app.localHost")} · {endpointLabel(LOCAL_TARGET)}
						</button>
						{host.hostList.hosts.map((entry) => (
							<button
								key={entry.id}
								type="button"
								className="boot-host"
								onClick={() => void host.selectHost(entry.endpoint)}
								disabled={host.endpoint === entry.endpoint}
							>
								{entry.name} · {endpointLabel(entry.endpoint)}
							</button>
						))}
					</div>
					<button type="button" className="boot-retry" onClick={host.reconnectNow}>
						{t("common.retry")}
					</button>
				</main>
				{passwordDialog}
			</AppFrame>
		);
	}
	return (
		<AppFrame>
			<main className="boot">
				<h1>{t("app.connecting")}</h1>
				<p>{host.endpoint}</p>
			</main>
			{passwordDialog}
		</AppFrame>
	);
}
