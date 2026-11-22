/**
 * 添加提供商的挑选弹窗。
 *
 * 只列还没配置的提供方，按名字搜索过滤。选中一个就交给提供方编辑弹窗去填地址与凭证，存完它
 * 出现在设置页的已配置列表里，也从这里消失。自定义提供方一律算已配置，不在这里出现。
 */
import { Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../common/Button.tsx";
import { IconButton } from "../common/IconButton.tsx";
import { Input } from "../common/Input.tsx";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { Modal } from "../modal.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import type { ProviderRow } from "./provider-rows.ts";

/** 挑选弹窗参数。 */
export interface ProviderPickerProps {
	/** 全部提供方，含自定义 */
	rows: readonly ProviderRow[];
	/** 选中一个还没配置的提供方 */
	onPick: (providerId: string) => void;
	/** 转到新建自定义提供方 */
	onCreateCustom: () => void;
	onClose: () => void;
}

/** 一个提供方算不算「已添加」：有凭证，或者本身就是自定义的。 */
function isAdded(row: ProviderRow): boolean {
	return row.provider.authenticated || row.custom !== undefined;
}

export function ProviderPicker({ rows, onPick, onCreateCustom, onClose }: ProviderPickerProps) {
	const { t } = useI18n();
	const [query, setQuery] = useState("");

	// 已经在用的不列：有凭证的、自定义的都不在这里
	const pending = useMemo(() => rows.filter((row) => !isAdded(row)), [rows]);
	const keyword = query.trim().toLowerCase();
	const visible =
		keyword.length === 0
			? pending
			: pending.filter(
					(row) =>
						row.provider.name.toLowerCase().includes(keyword) ||
						row.provider.id.toLowerCase().includes(keyword),
				);

	return (
		<Modal open onClose={onClose} label={t("picker.title")} className="is-picker">
			<div className="dialog-head">
				<h2 className="dialog-title">{t("picker.title")}</h2>
				<IconButton
					variant="ghost"
					size="sm"
					className="dialog-close"
					aria-label={t("common.close")}
					onClick={onClose}
				>
					<X size={ICON_SIZE.lg} />
				</IconButton>
			</div>

			<label className="picker-search">
				<Search size={ICON_SIZE.md} aria-hidden="true" />
				<Input
					variant="ghost"
					size="md"
					data-autofocus
					value={query}
					onChange={(event) => setQuery(event.target.value)}
					placeholder={t("picker.search")}
					aria-label={t("picker.search")}
				/>
			</label>

			<ul className="picker-list">
				{visible.map((row) => {
					const provider = row.provider;
					return (
						<li key={provider.id} className="picker-row">
							<span className="set-models-mark" aria-hidden="true">
								{provider.name.slice(0, 1).toUpperCase()}
							</span>
							<span className="picker-name ell">{provider.name}</span>
							<Button variant="secondary" size="sm" onClick={() => onPick(provider.id)}>
								{t("picker.add")}
							</Button>
						</li>
					);
				})}
				{visible.length === 0 ? (
					<li className="picker-empty">
						{pending.length === 0 ? t("picker.emptyConfigured") : t("picker.emptyMatch")}
					</li>
				) : null}
			</ul>

			<div className="dialog-actions">
				<Button variant="ghost" size="sm" className="prov-tone-accent" onClick={onCreateCustom}>
					<Plus size={ICON_SIZE.md} aria-hidden="true" />
					{t("picker.addCustom")}
				</Button>
				<Button variant="primary" size="md" onClick={onClose}>
					{t("picker.done")}
				</Button>
			</div>
		</Modal>
	);
}
