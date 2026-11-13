/**
 * 添加提供商的挑选弹窗。
 *
 * 列出 pi 目录里的全部提供方，内置的在前、自定义的在后，按名字搜索过滤。已经配置好凭证的
 * 标成「已添加」；没配置的直接在这里填 API key，存完这个提供方就出现在设置页的列表里。
 */
import type { CustomProviderInfo } from "@facet/protocol";
import { Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ProviderRow } from "./provider-rows.ts";

/** 挑选弹窗参数。 */
export interface ProviderPickerProps {
	/** 全部提供方，含自定义 */
	rows: readonly ProviderRow[];
	/** 存下某个提供方的凭证；失败时抛出并显示在那一行下面 */
	onSaveCredential: (providerId: string, key: string) => Promise<void>;
	/** 转到自定义提供方的编辑表单 */
	onEditCustom: (custom: CustomProviderInfo) => void;
	/** 转到新建自定义提供方的表单 */
	onCreateCustom: () => void;
	onClose: () => void;
}

/** 一个提供方算不算「已添加」：有凭证，或者本身就是自定义的。 */
function isAdded(row: ProviderRow): boolean {
	return row.provider.authenticated || row.custom !== undefined;
}

export function ProviderPicker({
	rows,
	onSaveCredential,
	onEditCustom,
	onCreateCustom,
	onClose,
}: ProviderPickerProps) {
	const [query, setQuery] = useState("");
	/** 展开输入凭证的提供方 */
	const [editingId, setEditingId] = useState<string | undefined>(undefined);
	const [key, setKey] = useState("");
	const [busyId, setBusyId] = useState<string | undefined>(undefined);
	const [failure, setFailure] = useState<{ providerId: string; message: string } | undefined>(undefined);
	const searchRef = useRef<HTMLInputElement>(null);

	// 打开即把光标放进搜索框，列表从头开始看
	useEffect(() => {
		searchRef.current?.focus({ preventScroll: true });
	}, []);

	// 内置在前、自定义在后；同组内保持目录顺序
	const ordered = useMemo(
		() => [...rows].sort((a, b) => Number(a.custom !== undefined) - Number(b.custom !== undefined)),
		[rows],
	);
	const keyword = query.trim().toLowerCase();
	const visible =
		keyword.length === 0
			? ordered
			: ordered.filter(
					(row) =>
						row.provider.name.toLowerCase().includes(keyword) ||
						row.provider.id.toLowerCase().includes(keyword),
				);

	const save = async (providerId: string): Promise<void> => {
		setBusyId(providerId);
		setFailure(undefined);
		try {
			await onSaveCredential(providerId, key);
			setEditingId(undefined);
			setKey("");
		} catch (error) {
			setFailure({ providerId, message: error instanceof Error ? error.message : String(error) });
		} finally {
			setBusyId(undefined);
		}
	};

	return (
		<div className="dialog-backdrop">
			<div className="dialog is-picker" role="dialog" aria-modal="true" aria-label="添加提供商">
				<div className="dialog-head">
					<h2 className="dialog-title">添加提供商</h2>
					<button type="button" className="dialog-close" aria-label="关闭" onClick={onClose}>
						<X size={18} strokeWidth={1.5} />
					</button>
				</div>

				<label className="picker-search">
					<Search size={14} strokeWidth={1.6} />
					<input
						ref={searchRef}
						className="picker-search-input"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="搜索提供商"
						aria-label="搜索提供商"
					/>
				</label>

				<ul className="picker-list">
					{visible.map((row) => {
						const provider = row.provider;
						const added = isAdded(row);
						const isBusy = busyId === provider.id;
						return (
							<li key={provider.id} className="picker-row">
								<div className="picker-row-head">
									<span className="picker-name ell">{provider.name}</span>
									{row.custom === undefined ? null : <span className="set-badge is-custom">自定义</span>}
									<span className={added ? "set-badge is-on" : "set-badge"}>
										{added ? "已添加" : "未配置"}
									</span>
									<span className="picker-meta mono">{provider.modelCount} 个模型</span>

									{row.custom !== undefined ? (
										<button
											type="button"
											className="set-row-action"
											onClick={() => onEditCustom(row.custom as CustomProviderInfo)}
										>
											编辑
										</button>
									) : provider.authenticated ? null : (
										<button
											type="button"
											className="set-row-action"
											onClick={() => {
												setFailure(undefined);
												setKey("");
												setEditingId(editingId === provider.id ? undefined : provider.id);
											}}
										>
											添加
										</button>
									)}
								</div>

								{editingId === provider.id ? (
									<div className="picker-key">
										<input
											className="set-input mono picker-key-input"
											type="password"
											value={key}
											onChange={(event) => setKey(event.target.value)}
											onKeyDown={(event) => {
												if (event.key === "Enter" && key.trim().length > 0) {
													void save(provider.id);
												}
											}}
											placeholder="粘贴 API key"
											aria-label={`${provider.name} 的 API key`}
										/>
										<button
											type="button"
											className="set-save"
											disabled={isBusy || key.trim().length === 0}
											onClick={() => void save(provider.id)}
										>
											{isBusy ? "保存中…" : "保存"}
										</button>
									</div>
								) : null}

								{failure?.providerId === provider.id ? (
									<p className="set-row-error">{failure.message}</p>
								) : null}
							</li>
						);
					})}
					{visible.length === 0 ? <li className="picker-empty">没有匹配的提供商</li> : null}
				</ul>

				<div className="dialog-actions">
					<button type="button" className="set-reset" onClick={onCreateCustom}>
						添加自定义提供方
					</button>
					<button type="button" className="set-save" onClick={onClose}>
						完成
					</button>
				</div>
			</div>
		</div>
	);
}
