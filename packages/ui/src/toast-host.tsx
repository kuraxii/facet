/**
 * 轻提示的渲染层。
 *
 * 只管画：队列、计时、暂停都由调用方处理。整条提示行不抢焦点、不打断输入，`role="status"`
 * 让读屏在空闲时念一遍即可。等级靠图标与左侧色条表达，文字只写事实，提示本身不带操作按钮。
 */
import { Check, CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./common/Button.tsx";
import { useI18n } from "./i18n/I18nProvider.tsx";
import { ICON_SIZE } from "./styles/visual-contract.ts";
import type { Toast, ToastLevel } from "./toast.ts";

/** 各等级的图标，配色交给 CSS。 */
const ICONS: Record<ToastLevel, typeof Info> = {
	info: Info,
	success: Check,
	warning: TriangleAlert,
	error: CircleAlert,
};

/** 轻提示区域参数。 */
export interface ToastHostProps {
	/** 当前要显示的提示，旧的在前 */
	toasts: readonly Toast[];
	/** 手动收掉一条 */
	onDismiss: (id: string) => void;
	/** 指针或焦点落在提示上时为真，调用方据此暂停计时 */
	onPauseChange: (paused: boolean) => void;
}

/** 右下角的提示区。没有提示时不渲染任何东西。 */
export function ToastHost({ toasts, onDismiss, onPauseChange }: ToastHostProps): ReactNode {
	const { t } = useI18n();
	if (toasts.length === 0) {
		return null;
	}
	const host = (
		<div
			className="toast-host"
			role="status"
			aria-live="polite"
			onPointerEnter={() => onPauseChange(true)}
			onPointerLeave={() => onPauseChange(false)}
		>
			{toasts.map((toast) => {
				const Icon = ICONS[toast.level];
				return (
					<div
						key={toast.id}
						className={`toast is-${toast.level}`}
						onFocusCapture={() => onPauseChange(true)}
						onBlurCapture={() => onPauseChange(false)}
					>
						<Icon className="toast-icon" size={ICON_SIZE.md} aria-hidden />
						<span className="toast-text">{toast.message}</span>
						{toast.count > 1 ? <span className="toast-count mono">{toast.count}</span> : null}
						{toast.action === undefined ? null : (
							<Button
								variant="ghost"
								size="sm"
								onClick={() => {
									toast.action?.onClick();
									onDismiss(toast.id);
								}}
							>
								{toast.action.label}
							</Button>
						)}
						<button
							type="button"
							className="toast-close"
							aria-label={t("app.closeNotice")}
							onClick={() => onDismiss(toast.id)}
						>
							<X size={ICON_SIZE.sm} />
						</button>
					</div>
				);
			})}
		</div>
	);
	// 挂到 body：主区与右栏的 overflow 都裁不到它。服务端渲染没有 body，直接内联渲染
	return typeof document === "undefined" ? host : createPortal(host, document.body);
}
