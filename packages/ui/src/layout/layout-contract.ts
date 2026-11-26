/**
 * 外壳与工作区的布局数值，以及样式与脚本共用的那几个属性名。
 *
 * 这里只放**两边都必须知道、又没法共享**的东西：容器查询与媒体查询里不能写 CSS 变量，属性
 * 选择器也只能写字面量，所以样式表那边永远是硬编码的。真值放在这里，各处引用它，再由
 * `layout-contract.test.ts` 回头读样式表源码逐条对齐——任何一边单独改动都会让测试红。
 *
 * 语义以 `docs/layout.md` 为准：本文件只是把它的「数值口径」表搬进代码，不引入新的判定规则。
 */

/** 窗口按钮簇里一枚按钮的边长。 */
const WINDOW_BUTTON_WIDTH = 44;

/** 窗口按钮簇里有几枚按钮。 */
const WINDOW_BUTTON_COUNT = 3;

/** 外壳布局的像素值。 */
export const LAYOUT_PX = {
	/** 档位断点，只在 `resolve-layout.ts` 判一次（样式里不写档位媒体查询）。 */
	breakpoint: {
		/** 窄档与中档的分界：小于它就是全高抽屉 */
		narrow: 880,
		/**
		 * 中档与宽档的分界：大于等于它两栏平铺。
		 *
		 * 这条线跟着「三栏缺省宽」走：左栏 272 + 正文最小 520 + 右栏 420 = 1212，再留一点余量
		 * 就是它。正文最小宽从 420 提到 520 之后（聊天区改成三列网格，正文要让出两侧轨道），
		 * 这条线也跟着上移——1120 到 1215 之间的窗口现在按中档处理，先折起一栏。
		 */
		wide: 1216,
	},
	/**
	 * 正文的最小可用宽。
	 *
	 * 与「阅读上限」（`--chat-column-max`）是两回事：这条是钳制左右两栏时给正文留住的地板。
	 * 520 = 52px 左留白 + 416px 正文 + 52px 右留白（100% 缩放）：两侧留白共用
	 * `--chat-rail-gutter`（要放得下导航轨），地板因此比旧值（420）高一档。
	 */
	mainMinWidth: 520,
	/** 左栏（会话侧栏）的偏好宽。 */
	sidebar: {
		/** 拖到最窄 */
		minWidth: 220,
		/** 没拖过时的宽度 */
		defaultWidth: 272,
		/** 拖到最宽；它自己有上限，所以偏好宽可以直接写下来 */
		maxWidth: 420,
	},
	/**
	 * 右栏（工作区）的偏好宽。
	 *
	 * 没有固定上限：上限由「视口宽 − 正文最小可用宽 − 左栏」现算，这里只收下限与缺省。
	 */
	panel: {
		/** 拖到最窄 */
		minWidth: 300,
		/** 没拖过时的宽度 */
		defaultWidth: 420,
	},
	/** 文件视图里文件树的宽度：与编辑器并排，右侧永远给编辑器留住 `editorKeepWidth`。 */
	fileTree: {
		/** 拖到最窄 */
		minWidth: 180,
		/** 没拖过时的宽度 */
		defaultWidth: 240,
		/** 拖到最宽 */
		maxWidth: 420,
		/** 再宽也要给编辑器留下的宽度 */
		editorKeepWidth: 120,
	},
	/** 右栏顶栏的标签：最挤时的一档容器折点。 */
	workspaceTabBar: {
		/**
		 * 容器窄于它时收紧标签间距与同排的 `+`、动作按钮间距。
		 *
		 * 标签本身不折、不裁：放不下就横着滚。与 `mainMinWidth` 同为 420 只是巧合——那个是
		 * 正文的地板，这个是顶栏最挤的那一段。
		 */
		tight: 420,
	},
	/**
	 * 右上角窗口按钮簇。
	 *
	 * 三枚按钮的一条 `fixed` 让位带：标签折点、右栏顶头的内边距都按它的宽度算。
	 */
	windowControls: {
		/** 一枚按钮的边长 */
		buttonWidth: WINDOW_BUTTON_WIDTH,
		/** 一排几枚 */
		buttonCount: WINDOW_BUTTON_COUNT,
		/** 整簇宽度：`--window-controls-width` 与它是同一个数 */
		width: WINDOW_BUTTON_WIDTH * WINDOW_BUTTON_COUNT,
	},
} as const;

/**
 * `.app` 上的拖拽折叠预览属性。
 *
 * 拖动进入待关闭态时由 `PaneResizer` 直接写在元素上、不经过 React，样式据此把对应列轨道摁到
 * `0`；值固定是 `"true"`。属性选择器只能写字面量，所以名字在这里定，样式表那边由契约测试
 * 对齐。
 */
export const SHELL_DATA_ATTRS = {
	/** 左栏拖到一半、准备关闭 */
	sidebarDragCollapsed: "data-sidebar-drag-collapsed",
	/** 右栏拖到一半、准备关闭 */
	panelDragCollapsed: "data-panel-drag-collapsed",
	/**
	 * 左栏分隔条被指针压住或正在拖。
	 *
	 * 只为一件事服务：把那一栏接缝染成强调色。状态必须落在 `.app` 上的属性里，不能用
	 * `.app:has(...)`——`.app` 包着整棵文档，`:has()` 的失效集合会让每次样式重算都按整棵树重验
	 * 一遍（实测 6.97 万元素时每帧多花 8.9ms，图表面板滚一下就掉一半帧）。
	 */
	sidebarResizerActive: "data-sidebar-resizer-active",
	/** 右栏分隔条被指针压住或正在拖，理由同上 */
	panelResizerActive: "data-panel-resizer-active",
} as const;
