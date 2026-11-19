/**
 * 一台主机的工作区。
 *
 * DOM 里同时只挂一份：切到别的主机时整棵子树卸载，回来时按端点重新挂上。这样两边的
 * 侧栏、标签与内容不可能串台，界面里也不会有看不见的另一台主机的节点。
 *
 * 组件卸载不等于断开：连接、会话与终端都留在运行时里继续跑，这里只重建「看」的那部分，
 * 起来时从工作区快照与客户端的既有状态接着显示。
 */
import { chatActivity } from "@facet/client-core";
import type { LanguageSetting } from "@facet/i18n";
import { appendQuote, sessionTabId, TextMenu, terminalTabId } from "@facet/ui";
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { bridge } from "../bridge.ts";
import { useComposer } from "../hooks/useComposer.ts";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import { useMainTabs } from "../hooks/useMainTabs.ts";
import { useNoticeBridge } from "../hooks/useNoticeBridge.ts";
import { useSessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import { useTerminalPanel } from "../hooks/useTerminalPanel.ts";
import { useReadMarker, useTranscript } from "../hooks/useTranscript.ts";
import { useWorkspaceShell } from "../hooks/useWorkspaceShell.ts";
import { useHostRuntime } from "../host-context.tsx";
import { placeCaretAtEnd, QUOTE_SOURCE_SELECTOR } from "../selection-quote.ts";
import { useToast } from "../toast-provider.tsx";
import { Workbench } from "./workbench.tsx";

export interface HostWorkspaceProps {
	/** 这台主机的连接域 */
	host: HostConnection;
	/** 语言设置与切换 */
	languageSetting: LanguageSetting;
	onLanguageChange: (setting: LanguageSetting) => void;
}

export function HostWorkspace({
	host,
	languageSetting,
	onLanguageChange,
}: HostWorkspaceProps): React.JSX.Element {
	const toast = useToast();
	const runtime = useHostRuntime();
	const client = runtime.client;
	const terminalClient = runtime.terminalClient;
	const version = useSyncExternalStore(
		(onChange) => client.store.subscribe(onChange),
		() => client.store.getVersion(),
	);
	void version;

	/**
	 * 打开会话、删除会话的收尾都落在标签与滚动位置上，那两处在这之后才建好，
	 * 这里经 ref 转一层，会话域拿到的始终是同一个回调。
	 */
	const focusSessionTab = useRef<(file: string) => void>(() => undefined);
	const forgetSession = useRef<(path: string) => void>(() => undefined);
	const onSessionOpened = useCallback((file: string) => focusSessionTab.current(file), []);
	const onSessionRemoved = useCallback((path: string) => forgetSession.current(path), []);

	const session = useSessionLifecycle({
		client,
		connectEpoch: host.connectEpoch,
		// 启动目录是本机的概念：远端主机上没有这个目录，打包态也可能压根没配
		projectDir: runtime.isLocal && bridge.projectDir.length > 0 ? bridge.projectDir : undefined,
		snapshot: runtime.workspace,
		onSessionOpened,
		onSessionRemoved,
	});

	// 续订回不来（会话文件已经不在了）时退回没有会话的状态，连接本身照常可用
	useEffect(() => {
		runtime.handlers.onSessionLost = () => session.resetActive();
		return () => {
			delete runtime.handlers.onSessionLost;
		};
	}, [runtime, session.resetActive]);

	const sessionView = client.sessionView();
	const chat = client.chatView();
	/** 当前会话的标识，图省事时用通道名兜底 */
	const openedSessionId = client.current?.snapshot.id;
	// 对话此刻的状态由会话状态得出，界面不自己拼布尔量
	const activity = chatActivity(sessionView);
	/** 会话所在的目录，git 命令都在它下面跑 */
	const sessionCwd = sessionView?.state.cwd;
	/** 终端能力：主机没装 pty 后端时不给入口 */
	const canUseTerminal = host.host?.capabilities.includes("terminal") ?? false;
	/** 新建终端的启动目录：跟着当前会话，没有会话时用第一个项目 */
	const terminalCwd = sessionCwd ?? session.projects[0]?.cwd;

	const shell = useWorkspaceShell({ settings: host.settings });

	const terminal = useTerminalPanel({
		client: terminalClient,
		canUseTerminal,
		cwd: terminalCwd,
		connectEpoch: host.connectEpoch,
		snapshot: runtime.workspace,
		showToast: toast.show,
	});

	const tabs = useMainTabs({
		client,
		session: sessionView,
		openedSessionId,
		terminals: terminal.terminals,
		closedTerminalIds: terminal.closedTerminalIds,
		snapshot: runtime.workspace,
		isPanelOnChanges: shell.panel.open && shell.panel.tab === "changes",
		onOpenSession: session.openSession,
	});

	// 主机侧通知与插件的 ctx.ui.notify 都走轻提示：后台会话的提示也能被看见
	useNoticeBridge({ chat, session: sessionView, sessionId: openedSessionId, show: toast.show });

	const transcript = useTranscript({
		client,
		chat,
		activeFile: session.activeFile,
		openedSessionId,
	});

	// 新会话摆到主区域；删掉会话时连标签与滚动位置一起收掉
	focusSessionTab.current = (file: string) => {
		const opened = client.current;
		if (opened === undefined) {
			return;
		}
		tabs.focusTab({
			id: sessionTabId(file, opened.snapshot.id),
			kind: "session",
			file,
			sessionId: opened.snapshot.id,
		});
	};
	forgetSession.current = (path: string) => {
		tabs.removeSessionTabs(path);
		transcript.forgetScroll(path);
	};

	const activeTab = tabs.tabs.find((item) => item.id === tabs.activeTabId);
	/** 变更是否正在显示：右栏停在变更分页，或主区打开着变更文档 */
	const isChangesVisible =
		(shell.panel.open && shell.panel.tab === "changes") || activeTab?.kind === "changes";

	useReadMarker({
		client,
		activeFile: session.activeFile,
		activity,
		refreshChanges: tabs.refreshChanges,
		isChangesVisible,
	});

	const composer = useComposer({
		client,
		session: sessionView,
		openedSessionId,
		activeFile: session.activeFile,
		activity,
		host: host.host,
		setSessionError: session.setSessionError,
		withTrust: session.withTrust,
		runSessionAction: session.runSessionAction,
		refreshSessions: session.refreshSessions,
	});

	/** 开一个终端并把它的标签摆到主区域。 */
	const openTerminal = useCallback(async () => {
		const info = await terminal.openTerminal();
		if (info !== undefined) {
			tabs.focusTab({ id: terminalTabId(info.id), kind: "terminal", terminalId: info.id });
		}
	}, [tabs, terminal]);

	/** 关掉一个标签；终端标签还要一并结束进程。 */
	const closeTab = useCallback(
		(id: string) => {
			const terminalId = tabs.closeTab(id);
			if (terminalId !== undefined) {
				void terminal.closeTerminal(terminalId);
			}
		},
		[tabs, terminal],
	);

	const closeTabs = useCallback(
		(ids: readonly string[]) => tabs.closeTabs(ids, (terminalId) => void terminal.closeTerminal(terminalId)),
		[tabs, terminal],
	);

	/** 标签菜单里的复制动作；成功用复制到的内容回执，失败给出剪贴板自己的说法。 */
	const copyText = useCallback(
		(text: string): void => {
			void navigator.clipboard.writeText(text).then(
				() => toast.show({ level: "success", message: text }),
				(error: unknown) =>
					toast.show({ level: "error", message: error instanceof Error ? error.message : String(error) }),
			);
		},
		[toast],
	);

	/** 对话里选中的文字被引用之后把光标放回输入框末尾 */
	const composerInput = useRef<HTMLTextAreaElement>(null);
	/** 把选中的文字做成引用块接进草稿 */
	const quoteInto = useCallback(
		(text: string): void => {
			composer.updateDraft((current) => appendQuote(current, text));
			placeCaretAtEnd(composerInput.current);
		},
		[composer],
	);

	// 快捷键 Ctrl + ` 回到终端标签；没有终端时在当前目录新建一个
	const tabList = tabs.tabs;
	const focusTab = tabs.focusTab;
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			if (event.key !== "`" || !(event.ctrlKey || event.metaKey)) {
				return;
			}
			event.preventDefault();
			const tab = tabList.find((item) => item.kind === "terminal");
			if (tab !== undefined) {
				focusTab(tab);
				return;
			}
			void openTerminal();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [focusTab, openTerminal, tabList]);

	return (
		<>
			<Workbench
				host={host}
				session={session}
				shell={shell}
				tabs={tabs}
				terminal={terminal}
				composer={composer}
				transcript={transcript}
				languageSetting={languageSetting}
				onLanguageChange={onLanguageChange}
				openedSessionId={openedSessionId}
				closeTab={closeTab}
				closeTabs={closeTabs}
				copyText={copyText}
				openTerminal={openTerminal}
				composerInput={composerInput}
			/>
			{/* 整棵工作区只挂一份：可选中文本处给复制，对话正文另加引用 */}
			<TextMenu onCopy={copyText} onQuote={quoteInto} quoteScope={QUOTE_SOURCE_SELECTOR} />
		</>
	);
}
