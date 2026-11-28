/**
 * 侧栏底部可折叠的 Settled 归档抽屉。
 *
 * 默认折叠；展开后每条归档压为单行紧凑项（弱化项目徽标 + 单行标题 + 相对时间），
 * 点击可查阅历史，右侧提供一键 Reopen 恢复按钮。
 */
import { Archive, RotateCcw } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import { useI18n } from "../i18n/I18nProvider.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { ChevronIcon } from "../transcript/chevron.tsx";
import type { SidebarSettledItem } from "./inbox-model.ts";

export interface SettledDrawerProps {
	/** 已归档条目，按归档时间倒序 */
	items: readonly SidebarSettledItem[];
	/** 当前选中的联合键 */
	activeKey: string | undefined;
	/** 点击查看某条已归档会话 */
	onSelect: (item: SidebarSettledItem) => void;
	/** 点击恢复回活跃 Inbox */
	onReopen: (item: SidebarSettledItem) => void;
}

export const SettledDrawer = memo(function SettledDrawer({
	items,
	activeKey,
	onSelect,
	onReopen,
}: SettledDrawerProps): ReactNode {
	const { t } = useI18n();
	const [isOpen, setIsOpen] = useState(false);

	if (items.length === 0) {
		return null;
	}

	return (
		<section className="settled-drawer" aria-label={t("inbox.settled")}>
			<button
				type="button"
				className="settled-toggle"
				aria-expanded={isOpen}
				onClick={() => setIsOpen((open) => !open)}
			>
				<Archive size={ICON_SIZE.sm} />
				<span className="settled-label">{t("inbox.settled")}</span>
				<span className="settled-count mono">{items.length}</span>
				<ChevronIcon isOpen={isOpen} />
			</button>
			{isOpen ? (
				<ul className="settled-list">
					{items.map((item) => {
						const isActive = item.key === activeKey;
						return (
							<li key={item.key} className={isActive ? "settled-item is-on" : "settled-item"}>
								<button type="button" className="settled-main" onClick={() => onSelect(item)}>
									<span className="settled-title ell">{item.title}</span>
									<span className="settled-time mono">{item.timeText}</span>
								</button>
								<button
									type="button"
									className="settled-reopen"
									aria-label={t("inbox.reopen")}
									onClick={() => onReopen(item)}
								>
									<RotateCcw size={ICON_SIZE.sm} />
								</button>
							</li>
						);
					})}
				</ul>
			) : null}
		</section>
	);
});
