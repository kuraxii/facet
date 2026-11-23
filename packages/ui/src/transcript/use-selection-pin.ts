/**
 * 拖选钉行。
 *
 * 行是按需挂载的：滚出视口就卸载。原生选区一旦跨过被卸载的行，浏览器会把选区断在边界上，
 * 右键「复制」/「引用」拿到的是半截文字。这里把「选区跨过了哪两行」记下来，交给
 * `extractPinnedRange` 把这中间一段留在 DOM 里，选区因此始终是完整的一段真实文本。
 *
 * 只认落在对话正文里的选区：选区伸到面板外面（比如拖到侧栏）时两端凑不齐，谁也不钉。
 */
import { useEffect, useState } from "react";
import { TRANSCRIPT_DATA_ATTRS } from "../layout/layout-contract.ts";

/** 选区两端所在的行标识，可能反序；不在同一块正文里时为 `null`。 */
export type SelectionPin = readonly [string, string] | null;

/** 从选区的一个节点往上找它属于哪一行。 */
function rowIdOf(node: Node | null, column: HTMLElement): string | undefined {
	if (node === null) {
		return undefined;
	}
	const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
	if (element === null || !column.contains(element)) {
		return undefined;
	}
	return (
		element.closest(`[${TRANSCRIPT_DATA_ATTRS.rowId}]`)?.getAttribute(TRANSCRIPT_DATA_ATTRS.rowId) ??
		undefined
	);
}

/**
 * 跟着原生选区更新要钉住的两行。
 *
 * `enabled` 为假时（没有滚动容器、或者根本没虚拟化）不装监听：没有行会滚动卸载，
 * 钉行纯属多余。
 */
export function useSelectionPin(column: HTMLElement | null, enabled: boolean): SelectionPin {
	const [pin, setPin] = useState<SelectionPin>(null);

	useEffect(() => {
		if (!enabled || column === null) {
			setPin(null);
			return;
		}
		const update = (): void => {
			const selection = document.getSelection();
			if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
				setPin(null);
				return;
			}
			const start = rowIdOf(selection.anchorNode, column);
			const end = rowIdOf(selection.focusNode, column);
			// 同一行里拖选不需要钉：那一行本来就在视口里
			const next: SelectionPin =
				start === undefined || end === undefined || start === end ? null : [start, end];
			setPin((previous) => {
				if (previous === next) {
					return previous;
				}
				if (previous !== null && next !== null && previous[0] === next[0] && previous[1] === next[1]) {
					return previous;
				}
				return next;
			});
		};
		document.addEventListener("selectionchange", update);
		return () => {
			document.removeEventListener("selectionchange", update);
		};
	}, [column, enabled]);

	return pin;
}
