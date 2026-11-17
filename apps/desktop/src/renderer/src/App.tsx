import { chatActivity } from "@facet/client-core";
import type { LanguageSetting } from "@facet/i18n";
import { I18nProvider, sessionTabId, terminalTabId } from "@facet/ui";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useComposer } from "./hooks/useComposer.ts";
import { useHostConnection } from "./hooks/useHostConnection.ts";
import { useMainTabs } from "./hooks/useMainTabs.ts";
import { useSessionLifecycle } from "./hooks/useSessionLifecycle.ts";
import { useTerminalPanel } from "./hooks/useTerminalPanel.ts";
import { useReadMarker, useTranscript } from "./hooks/useTranscript.ts";
import { useWorkspaceShell } from "./hooks/useWorkspaceShell.ts";
import { bridge, client, terminalClient } from "./runtime.ts";
import { BootScreen } from "./views/boot-screen.tsx";
import { Workbench } from "./views/workbench.tsx";

/** 界面外壳参数；语言状态在外层维护，切换语言不重建 AppView 的无关心状态。 */
interface AppViewProps {
	languageSetting: LanguageSetting;
	onLanguageChange: (setting: LanguageSetting) => void;
}

/** 界面语言从本机桥读入，切换时由主进程或 Web 桥解析实际语言。 */
export function App(): React.JSX.Element {
	const [languageSetting, setLanguageSetting] = useState(bridge.languageSetting);
	const [language, setLanguage] = useState(bridge.language);
	const changeLanguage = useCallback((setting: LanguageSetting) => {
		setLanguageSetting(setting);
		void bridge
			.setLanguage(setting)
			.then(setLanguage)
			.catch(() => undefined);
	}, []);
	return (
		<I18nProvider language={language}>
			<AppView languageSetting={languageSetting} onLanguageChange={changeLanguage} />
		</I18nProvider>
	);
}

function AppView({ languageSetting, onLanguageChange }: AppViewProps) {
	const version = useSyncExternalStore(
		(onChange) => client.store.subscribe(onChange),
		() => client.store.getVersion(),
	);
	void version;

	/** 会话域要在连接成功之后才建好；续订回不来时由连接域叫它退回没有会话的状态 */
	const sessionDomain = useRef<{ resetActive: () => void } | null>(null);
	const onSessionLost = useCallback(() => sessionDomain.current?.resetActive(), []);
	const host = useHostConnection({ onSessionLost });

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
		hostEpoch: host.hostEpoch,
		projectDir: bridge.projectDir,
		defaultThinkingLevel: host.settings.defaultThinkingLevel,
		onSessionOpened,
		onSessionRemoved,
	});
	sessionDomain.current = session;

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
	});

	const tabs = useMainTabs({
		client,
		session: sessionView,
		openedSessionId,
		terminals: terminal.terminals,
		closedTerminalIds: terminal.closedTerminalIds,
		hostEpoch: host.hostEpoch,
		isPanelOnChanges: shell.panel.open && shell.panel.tab === "changes",
		onOpenSession: session.openSession,
	});

	const transcript = useTranscript({
		client,
		chat,
		session: sessionView,
		activeFile: session.activeFile,
		openedSessionId,
		hostEpoch: host.hostEpoch,
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

	/** 标签菜单里的复制动作。 */
	const copyText = useCallback((text: string): void => {
		void navigator.clipboard.writeText(text).catch(() => undefined);
	}, []);

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

	// 连不上与连接中各占一屏，主工作区只在可用之后渲染
	if (host.phase !== "ready") {
		return <BootScreen host={host} />;
	}

	return (
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
		/>
	);
}
