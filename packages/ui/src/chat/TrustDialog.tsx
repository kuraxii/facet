/**
 * 项目信任确认。
 *
 * 目录里有项目级扩展、skill 或 MCP 配置时，第一次打开前问一次；决定会被记住，之后同一目录
 * 不再询问。不信任只是不加载这些项目级资源，会话本身照常可用。
 */

import { X } from "lucide-react";
import { Button } from "../common/Button.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Modal } from "../modal.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ShieldIcon } from "../transcript/icons.tsx";

/** 确认框参数。 */
export interface TrustDialogProps {
	/** 待确认的目录 */
	cwd: string;
	/** 用户的决定 */
	onDecide: (trusted: boolean) => void;
	/** 取消打开，不记录决定 */
	onCancel: () => void;
}

export function TrustDialog({ cwd, onDecide, onCancel }: TrustDialogProps) {
	const { t } = useI18n();

	return (
		<Modal open onClose={onCancel} label={t("trust.label")}>
			<div className="dialog-head">
				<h2 className="dialog-title">{t("trust.title")}</h2>
				<IconButton
					variant="ghost"
					size="sm"
					className="dialog-close"
					aria-label={t("common.close")}
					onClick={onCancel}
				>
					<X size={ICON_SIZE.lg} />
				</IconButton>
			</div>

			<p className="dialog-label">{t("trust.directory")}</p>
			<div className="source-box">
				<span className="source-path mono">{cwd}</span>
			</div>

			<div className="trust-note">
				<span className="trust-icon">
					<ShieldIcon size={ICON_SIZE.lg} />
				</span>
				<span className="trust-text">
					<span>{t("trust.hasConfig")}</span>
					<span>{t("trust.loadHint")}</span>
					<span>{t("trust.remember")}</span>
				</span>
			</div>

			<div className="dialog-actions">
				<Button variant="ghost" size="md" onClick={() => onDecide(false)}>
					{t("trust.notTrust")}
				</Button>
				<Button variant="primary" size="md" data-autofocus onClick={() => onDecide(true)}>
					{t("trust.trustOpen")}
				</Button>
			</div>
		</Modal>
	);
}
