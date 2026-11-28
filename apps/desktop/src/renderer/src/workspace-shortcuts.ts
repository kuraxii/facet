/**
 * 工作区工具的快捷键。
 *
 * 提示与真实绑定共用这一份：启动清单与 `+` 菜单上写的就是这里算出来的键位，`Ctrl + 反引号`
 * 那一条同时由 `views/host-workspace.tsx` 的键盘处理读它，两边不可能写岔。
 *
 * 与已有的绑定不冲突：`Mod+K` 是会话搜索，`Mod+=/-/0` 是界面缩放，`Mod+Shift+E/G/H` 与
 * `Mod+\`` 此前都没人用（口径见 `docs/ui_design_specification.md` §2）。
 */
import { formatShortcut, type ShortcutChord, type WorkspaceTabId } from "@facet/ui";

/** 四件工具的键位。 */
export const WORKSPACE_SHORTCUTS: Readonly<Record<WorkspaceTabId, ShortcutChord>> = {
	/** 文件：与编辑器的「资源管理器」同一套 */
	files: { mod: true, shift: true, key: "E" },
	/** 变更：与编辑器的「源代码管理」同一套 */
	changes: { mod: true, shift: true, key: "G" },
	/** 提交图谱：`H` 取 history，与变更的 `G` 挨着 */
	"git-graph": { mod: true, shift: true, key: "H" },
	/** 终端：沿用三栏时期就有的 `Ctrl + 反引号` */
	terminal: { mod: true, key: "`" },
	/** 浏览器：右栏内嵌网页与本地预览 */
	browser: { mod: true, shift: true, key: "B" },
};

/**
 * 这一次按键打开了哪件工具。
 *
 * 主键不区分大小写：按住 Shift 时浏览器给的是大写字母。修饰键必须**恰好**对上——多按了
 * Alt 或 Shift 就不算，免得抢走别的绑定。
 */
export function workspaceShortcutOf(event: KeyboardEvent): WorkspaceTabId | undefined {
	const ids = Object.keys(WORKSPACE_SHORTCUTS) as WorkspaceTabId[];
	for (const id of ids) {
		const chord = WORKSPACE_SHORTCUTS[id];
		if ((chord.mod === true) !== (event.ctrlKey || event.metaKey)) continue;
		if ((chord.shift === true) !== event.shiftKey) continue;
		if ((chord.alt === true) !== event.altKey) continue;
		if (event.key.toLowerCase() !== chord.key.toLowerCase()) continue;
		return id;
	}
	return undefined;
}

/** 界面上展示的键位提示。 */
export function workspaceShortcutLabel(id: WorkspaceTabId, isMac: boolean): string {
	return formatShortcut(isMac, WORKSPACE_SHORTCUTS[id]);
}
