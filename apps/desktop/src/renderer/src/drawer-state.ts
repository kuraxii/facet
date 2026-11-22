/**
 * 窄档侧栏抽屉的开关与 Escape 优先级。
 *
 * 纯函数：只决定「这次 Escape 归不归抽屉处理」，以及外壳该挂哪些类名，不碰 DOM。
 *
 * 抽屉是临时视图：开关不写回宽档的意图位（侧栏收起位），窗口拉宽后仍按用户原来的意图平铺。
 * 右栏没有抽屉——它在任何档位都占列，窄下去只是变窄。
 */

/** 判定抽屉该不该吃这次 Escape 的输入。 */
export interface DrawerEscapeInput {
	/** keydown 是否已被内层浮层用 `preventDefault()` 吃掉 */
	readonly defaultPrevented: boolean;
	/** 文档里是否有打开的原生 `<dialog>`（设置页、会话搜索等） */
	readonly hasOpenDialog: boolean;
}

/**
 * 一次 Escape 只关最内层。
 *
 * 内层浮层（行内重命名、右键菜单、`text-menu`、下拉弹层）已经在自己的监听里
 * `preventDefault()`；原生 `<dialog>` 关的是它自己的 close watcher，不会改 keydown 的
 * `defaultPrevented`，所以额外看有没有开着的弹窗——弹窗开着时抽屉留在原地。
 */
export function shouldCloseDrawerOnEscape(input: DrawerEscapeInput): boolean {
	return !input.defaultPrevented && !input.hasOpenDialog;
}

/**
 * 外壳的类名。
 *
 * 只管两件与抽屉有关的事：窄档里抽屉开着时给 `has-drawer`（遮罩与抽屉样式据此上屏），
 * 侧栏可见时给 `is-sb-open`。栏位显隐是 `.app` 上的事，不在这里。
 */
export function shellClassName(input: {
	/** 侧栏此刻是否可见 */
	isSidebarOpen: boolean;
	/** 左抽屉是否开着 */
	isDrawerOpen: boolean;
	/** 是否窄档 */
	isNarrow: boolean;
}): string {
	const names = ["shell"];
	if (input.isNarrow && input.isDrawerOpen) {
		names.push("has-drawer");
	}
	if (input.isSidebarOpen) {
		names.push("is-sb-open");
	}
	return names.join(" ");
}
