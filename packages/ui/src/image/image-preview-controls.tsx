/**
 * 图片预览浮层上的两簇控件。
 *
 * 只有两处：右上角是下载与关闭，底部居中是缩放（减、百分比、加）。其余动作都走键位与手势——
 * 双击在 100% 与适应窗口之间切、滚轮缩放、放大后拖拽平移、`←` / `→` 在同一组图片之间翻——
 * 控制条上不再摆它们，项越少越不挡图。
 *
 * 两簇都是浮在图片上的胶囊：底色 `--bg-surface`、轮廓只由 `--shadow-popover` 那条 1px 环给。
 */
import { Download, Minus, Plus, X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "../common/IconButton.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";

/** 右上角的两个动作。 */
export interface ImagePreviewActionsProps {
	/** 下载这张图 */
	onSave: () => void;
	/** 关掉浮层 */
	onClose: () => void;
}

/** 右上角：下载与关闭。 */
export function ImagePreviewActions({ onSave, onClose }: ImagePreviewActionsProps): ReactNode {
	const { t } = useI18n();
	return (
		<div className="image-preview-actions">
			<IconButton size="sm" aria-label={t("imagePreview.save")} onClick={onSave}>
				<Download size={ICON_SIZE.lg} />
			</IconButton>
			<IconButton size="sm" aria-label={t("common.close")} onClick={onClose}>
				<X size={ICON_SIZE.lg} />
			</IconButton>
		</div>
	);
}

/** 底部居中的缩放。 */
export interface ImagePreviewZoomProps {
	/** 当前的百分比文字，例如 `100%` */
	percent: string;
	/** 放大一档 */
	onZoomIn: () => void;
	/** 缩小一档 */
	onZoomOut: () => void;
}

/** 底部居中：减、百分比、加。 */
export function ImagePreviewZoom({ percent, onZoomIn, onZoomOut }: ImagePreviewZoomProps): ReactNode {
	const { t } = useI18n();
	return (
		<div className="image-preview-zoom">
			<IconButton size="sm" aria-label={t("imagePreview.zoomOut")} onClick={onZoomOut}>
				<Minus size={ICON_SIZE.lg} />
			</IconButton>
			{/* 等宽数字：百分比位数不变时两侧按钮不会被推着走 */}
			<span className="image-preview-scale">{percent}</span>
			<IconButton size="sm" aria-label={t("imagePreview.zoomIn")} onClick={onZoomIn}>
				<Plus size={ICON_SIZE.lg} />
			</IconButton>
		</div>
	);
}
