/**
 * 设置页的分组卡片。
 *
 * 一页设置按主题分成若干组：组标题在上，下面是卡片；卡片里每行左侧是名字、右侧是控件。
 * 控件宽度不一，所以右侧那一列可以放开关、下拉、按钮或一整排色块。
 */
import type { ReactNode } from "react";
import { ListRow } from "../common/ListRow.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";

export interface SettingsGroupProps {
	/** 组标题，省略时只有卡片 */
	label?: string;
	/** 组内的行 */
	children: ReactNode;
}

export function SettingsGroup({ label, children }: SettingsGroupProps): React.JSX.Element {
	return (
		<section className="set-group">
			{label === undefined ? null : <h3 className="set-group-title">{label}</h3>}
			<div className="set-card">{children}</div>
		</section>
	);
}

export interface SettingsRowProps {
	/** 行标题 */
	title: string;
	/** 右侧控件 */
	children?: ReactNode;
	/** 控件换行放到标题下面，适合色块、长列表这类需要整行宽度的控件 */
	isStacked?: boolean;
}

export function SettingsRow({ title, children, isStacked = false }: SettingsRowProps): React.JSX.Element {
	return (
		<ListRow interactive={false} className={isStacked ? "set-item is-stacked" : "set-item"}>
			<div className="set-item-text">
				<span className="set-item-title">{title}</span>
			</div>
			{children === undefined ? null : <div className="set-item-control">{children}</div>}
		</ListRow>
	);
}

/** 一段读取或保存失败的信息，带重试。 */
export interface StatusNoteProps {
	/** 要显示的那句话，只写事实内容 */
	message: string;
	/** 重试 */
	onRetry: () => void;
}

export function StatusNote({ message, onRetry }: StatusNoteProps): React.JSX.Element {
	const { t } = useI18n();
	return (
		<div className="set-note is-error">
			<span>{message}</span>
			<button type="button" className="set-note-action" onClick={onRetry}>
				{t("common.retry")}
			</button>
		</div>
	);
}
