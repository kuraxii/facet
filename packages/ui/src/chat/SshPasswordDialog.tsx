/**
 * SSH 登录密码。
 *
 * 只有在 ssh-agent 与 ~/.ssh 私钥都用不上、或者被服务器拒绝时才问一次。密码留在桌面主进程
 * 内存里供重连使用，不写进主机清单。
 */

import { X } from "lucide-react";
import { useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { isComposingKey } from "../keys.ts";
import { Modal } from "../modal.tsx";

/** 密码框参数。 */
export interface SshPasswordDialogProps {
	/** 目标主机给人看的写法 */
	host: string;
	/** 上一次填的密码被拒 */
	isRetry: boolean;
	/** 提交密码 */
	onSubmit: (password: string) => void;
	/** 放弃连接 */
	onCancel: () => void;
}

export function SshPasswordDialog({ host, isRetry, onSubmit, onCancel }: SshPasswordDialogProps) {
	const { t } = useI18n();
	const [password, setPassword] = useState("");
	const inputRef = useRef<HTMLInputElement>(null);

	const submit = (): void => {
		if (password.length === 0) {
			return;
		}
		onSubmit(password);
	};

	return (
		<Modal open onClose={onCancel} label={t("ssh.title")} className="is-narrow">
			<div className="dialog-head">
				<h2 className="dialog-title">{t("ssh.heading", { host })}</h2>
				<button type="button" className="dialog-close" aria-label={t("common.close")} onClick={onCancel}>
					<X size={18} strokeWidth={1.5} />
				</button>
			</div>

			<p className="dialog-label">{t("ssh.password")}</p>
			<input
				ref={inputRef}
				className="set-input ssh-password-input"
				type="password"
				aria-label={t("ssh.label")}
				autoComplete="current-password"
				value={password}
				onChange={(event) => setPassword(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter" && !isComposingKey(event)) {
						submit();
					}
				}}
			/>
			{isRetry ? <p className="ssh-password-error">{t("ssh.wrong")}</p> : null}

			<div className="dialog-actions">
				<button type="button" className="dialog-cancel" onClick={onCancel}>
					{t("common.cancel")}
				</button>
				<button type="button" className="dialog-primary" onClick={submit} disabled={password.length === 0}>
					{t("ssh.connect")}
				</button>
			</div>
		</Modal>
	);
}
