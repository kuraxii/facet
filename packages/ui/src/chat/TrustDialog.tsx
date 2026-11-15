/**
 * 项目信任确认。
 *
 * 目录里有项目级扩展、skill 或 MCP 配置时，第一次打开前问一次；决定会被记住，之后同一目录
 * 不再询问。不信任只是不加载这些项目级资源，会话本身照常可用。
 */

import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
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
	const trustRef = useRef<HTMLButtonElement>(null);

	// 打开即把焦点放在主按钮，Esc 取消
	useEffect(() => {
		const frame = requestAnimationFrame(() => trustRef.current?.focus());
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				onCancel();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => {
			cancelAnimationFrame(frame);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [onCancel]);

	return (
		<div className="dialog-backdrop">
			<div className="dialog" role="dialog" aria-modal="true" aria-label={t("trust.label")}>
				<div className="dialog-head">
					<h2 className="dialog-title">{t("trust.title")}</h2>
					<button type="button" className="dialog-close" aria-label={t("common.close")} onClick={onCancel}>
						<X size={18} strokeWidth={1.5} />
					</button>
				</div>

				<p className="dialog-label">{t("trust.directory")}</p>
				<div className="source-box">
					<span className="source-path mono" title={cwd}>
						{cwd}
					</span>
				</div>

				<div className="trust-note">
					<span className="trust-icon">
						<ShieldIcon size={15} />
					</span>
					<span className="trust-text">
						<span>{t("trust.hasConfig")}</span>
						<span>{t("trust.loadHint")}</span>
						<span>{t("trust.remember")}</span>
					</span>
				</div>

				<div className="dialog-actions">
					<button type="button" className="dialog-cancel" onClick={() => onDecide(false)}>
						{t("trust.notTrust")}
					</button>
					<button ref={trustRef} type="button" className="dialog-primary" onClick={() => onDecide(true)}>
						{t("trust.trustOpen")}
					</button>
				</div>
			</div>
		</div>
	);
}
