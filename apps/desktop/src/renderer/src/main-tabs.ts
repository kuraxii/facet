/**
 * 主区域标签的呈现映射。
 *
 * 把标签数据与它引用的会话、终端信息合成标签栏要的文字；纯函数，不碰 DOM，便于单独验证。
 */
import type { SessionView } from "@facet/client-core";
import type { TerminalInfo } from "@facet/protocol";
import { baseName, type MainTab, type MainTabItem, sessionTitle } from "@facet/ui";

/** 把项目内的相对路径拼成绝对路径。 */
export function absoluteProjectPath(cwd: string, path: string): string {
	if (path.startsWith("/")) {
		return path;
	}
	return cwd.endsWith("/") ? `${cwd}${path}` : `${cwd}/${path}`;
}

/** 标签标题需要的会话信息。 */
export interface TabSessionFacts {
	/** 当前打开的会话视图，没有会话时为空 */
	readonly session: SessionView | undefined;
	/** 当前会话的标识，缺省时用通道名兜底 */
	readonly openedSessionId: string | undefined;
	/** 会话清单，取标签指向的那条的名字与首条消息 */
	readonly summaries: readonly { path: string; name: string | undefined; firstMessage: string }[];
}

/** 标签文案。 */
export interface TabText {
	/** 没有标题时的占位 */
	readonly untitled: string;
	/** 变更文档的标题 */
	readonly changes: string;
	/** 单个变更文档的标题前缀 */
	readonly diff: string;
	/** 提交文档的标题 */
	readonly commit: (sha: string) => string;
	/** 还没连上主机的终端 */
	readonly newTerminal: string;
}

/** 一条会话标签此刻指向的是不是当前会话。 */
export function isCurrentSessionTab(tab: MainTab, facts: TabSessionFacts): boolean {
	if (tab.kind !== "session" || facts.session === undefined) {
		return false;
	}
	if (facts.session.state.file === tab.file) {
		return true;
	}
	return tab.file === undefined && (facts.openedSessionId ?? facts.session.channel) === tab.sessionId;
}

/** 把标签数据与它引用的会话、终端信息合成标签栏要的文字。 */
export function toTabItems(
	tabs: readonly MainTab[],
	terminals: readonly TerminalInfo[],
	facts: TabSessionFacts,
	text: TabText,
): MainTabItem[] {
	return tabs.map((tab) => {
		if (tab.kind === "session") {
			const summary = facts.summaries.find((item) => item.path === tab.file);
			const name = isCurrentSessionTab(tab, facts) ? facts.session?.state.title : summary?.name;
			const label = sessionTitle(name, summary?.firstMessage ?? "", text.untitled);
			return {
				id: tab.id,
				kind: tab.kind,
				label,
				title: tab.file ?? label,
				closable: true,
			};
		}
		if (tab.kind === "file") {
			return {
				id: tab.id,
				kind: tab.kind,
				label: tab.path,
				title: tab.path,
				closable: true,
				copyPath: {
					absolute: absoluteProjectPath(tab.cwd, tab.path),
					relative: tab.path,
				},
			};
		}
		if (tab.kind === "diff") {
			return {
				id: tab.id,
				kind: tab.kind,
				label: `${text.diff} · ${baseName(tab.path)}`,
				title: tab.path,
				closable: true,
				copyPath: {
					absolute: absoluteProjectPath(tab.cwd, tab.path),
					relative: tab.path,
				},
			};
		}
		if (tab.kind === "changes") {
			return {
				id: tab.id,
				kind: tab.kind,
				label: text.changes,
				title: tab.cwd,
				closable: true,
			};
		}
		if (tab.kind === "commit") {
			return {
				id: tab.id,
				kind: tab.kind,
				label: text.commit(tab.shortSha),
				title: `${tab.shortSha} · ${tab.subject}`,
				closable: true,
			};
		}
		if (tab.kind !== "terminal") {
			// 标签种类穷尽后不会走到这里；留着让类型收窄到终端
			throw new Error(`unexpected tab kind: ${String(tab)}`);
		}
		const terminal = terminals.find((item) => item.id === tab.terminalId);
		return {
			id: tab.id,
			kind: tab.kind,
			label: terminal === undefined ? text.newTerminal : baseName(terminal.cwd),
			title: terminal === undefined ? tab.terminalId : `${terminal.shell} · ${terminal.cwd}`,
			closable: true,
		};
	});
}
