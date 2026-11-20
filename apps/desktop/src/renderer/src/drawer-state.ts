/**
 * 窄档抽屉的开关与 Escape 优先级。
 *
 * 纯函数：只决定「此刻开哪一个抽屉」与「这次 Escape 归不归抽屉处理」，不碰 DOM。
 *
 * 窄档抽屉是临时视图：开关不写回宽档的意图位（`panel.open` 与侧栏收起位），窗口拉宽后
 * 仍按用户原来的意图平铺。
 */

/** 窄档里能开的那两个抽屉。 */
export type NarrowDrawer = "sidebar" | "panel";

/**
 * 切换抽屉：开一个就关另一个（互斥），再点同一个就全关。
 *
 * 互斥是纯状态推导，不靠两个布尔量的先后赋值：同一时刻最多只有一个抽屉被记着。
 */
export function toggleNarrowDrawer(
	current: NarrowDrawer | undefined,
	next: NarrowDrawer,
): NarrowDrawer | undefined {
	return current === next ? undefined : next;
}

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
