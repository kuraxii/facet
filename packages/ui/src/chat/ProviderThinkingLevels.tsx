/**
 * 模型行里的「思考档位」单元格。
 *
 * 这一格读作「思考到哪一档」，点开是一层七档的复选菜单：勾上的档位就是 pi 的
 * `thinkingLevelMap` 里可用的那几档，不勾的写 `null`（这一档不支持）。全部不勾表示这个模型
 * 不会思考。
 *
 * 菜单走原生 Popover（`popover="auto"` + `popovertarget`）：它在浏览器 Top Layer 里，
 * 不会被设置窗的滚动区裁掉，点外面由浏览器收掉。落点由 CSS 锚点定位给：触发器上挂动态的
 * `anchor-name`，菜单按它贴边，下方放不下时翻到触发器上方。`Esc` 得自己拦一道——原生 Popover
 * 收菜单的同时，设置窗那个 `<dialog>` 也会收到同一个按键，不拦就一次关掉两层。
 */
import type { ThinkingLevel } from "@facet/protocol";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Button } from "../common/Button.tsx";
import { ICON_SIZE } from "../styles/visual-contract.ts";
import { THINKING_LEVELS, toggleThinkingLevel, topThinkingLevel } from "./provider-thinking-levels.ts";

/** 一格思考档位。 */
export interface ProviderThinkingLevelsProps {
	/** 当前勾中的档位 */
	levels: readonly ThinkingLevel[];
	/** 勾选变化 */
	onChange: (levels: ThinkingLevel[]) => void;
	/** 这一格的可访问名，带模型序号 */
	label: string;
	/** 菜单的锚点名，同一页里唯一；由模型行的键派生 */
	anchor: string;
}

/** 思考档位单元格。 */
export function ProviderThinkingLevels({
	levels,
	onChange,
	label,
	anchor,
}: ProviderThinkingLevelsProps): ReactNode {
	const [isOpen, setIsOpen] = useState(false);
	const menu = useRef<HTMLFieldSetElement>(null);
	const top = topThinkingLevel(levels);

	/**
	 * 菜单开着时由这一层先吃下 `Esc`。
	 *
	 * 原生 Popover 的 `Esc` 只收掉菜单，但设置窗那个 `<dialog>` 也会对同一个按键发起关闭请求，
	 * 于是菜单开着时按一下会把弹窗一起关掉。监听器挂在 `document` 的捕获阶段：焦点可能落在
	 * 触发器上、也可能在菜单里某一格上，都不该影响这次拦截；在默认行为之前 `preventDefault()`
	 * 与其它浮层同一套约定——外层看到按键已被吃掉，就不再跟着关。
	 */
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const onDocumentKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "Escape") {
				return;
			}
			event.preventDefault();
			menu.current?.hidePopover();
			setIsOpen(false);
		};
		document.addEventListener("keydown", onDocumentKeyDown, true);
		return () => document.removeEventListener("keydown", onDocumentKeyDown, true);
	}, [isOpen]);

	return (
		<span className="prov-levels">
			<Button
				variant="secondary"
				size="sm"
				className="prov-levels-trigger"
				aria-label={label}
				aria-expanded={isOpen}
				popoverTarget={anchor}
				style={{ anchorName: `--${anchor}` }}
			>
				{/* 一档都没勾时给一道横线：这一格是空的，不是「关」 */}
				<span className="prov-levels-value">{top ?? "—"}</span>
				<ChevronDown size={ICON_SIZE.sm} aria-hidden="true" />
			</Button>
			{/* 一组复选框：用 fieldset 自带的 group 语义，不再手写 role */}
			<fieldset
				ref={menu}
				id={anchor}
				popover="auto"
				aria-label={label}
				className="prov-levels-menu"
				style={{ positionAnchor: `--${anchor}` }}
				onToggle={(event) => setIsOpen(event.currentTarget.matches(":popover-open"))}
			>
				{THINKING_LEVELS.map((level) => (
					<label key={level} className="prov-levels-item" data-level={level}>
						<input
							type="checkbox"
							checked={levels.includes(level)}
							onChange={() => onChange(toggleThinkingLevel(levels, level))}
						/>
						<span className="prov-levels-name">{level}</span>
					</label>
				))}
			</fieldset>
		</span>
	);
}
