/**
 * 一台主机的工作区。
 *
 * DOM 里同时只挂一份：切到别的主机时整棵子树卸载，回来时按端点重新挂上。这样两边的
 * 侧栏、分页与内容不可能串台，界面里也不会有看不见的另一台主机的节点。
 *
 * 组件卸载不等于断开：连接、会话与终端都留在运行时里继续跑，这里只重建「看」的那部分，
 * 起来时从工作区快照与客户端的既有状态接着显示。
 */
import { chatActivity } from "@facet/client-core";
import type { LanguageSetting } from "@facet/i18n";
import { appendQuote, TextMenu } from "@facet/ui";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { bridge } from "../bridge.ts";
import { useComposer } from "../hooks/useComposer.ts";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import { useNoticeBridge } from "../hooks/useNoticeBridge.ts";
import { useSessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import { useTerminalPanel } from "../hooks/useTerminalPanel.ts";
import { useReadMarker, useTranscript } from "../hooks/useTranscript.ts";
import { useWorkspaceDocs } from "../hooks/useWorkspaceDocs.ts";
import { useWorkspaceShell } from "../hooks/useWorkspaceShell.ts";
import { useHostRuntime } from "../host-context.tsx";
import { placeCaretAtEnd, QUOTE_SOURCE_SELECTOR } from "../selection-quote.ts";
import { useToast } from "../toast-provider.tsx";
import { workspaceShortcutOf } from "../workspace-shortcuts.ts";
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

	/** 删掉会话之后的收尾：滚动位置在那之后才建好，这里经 ref 转一层。 */
	const forgetSession = useRef<(path: string) => void>(() => undefined);
	const onSessionRemoved = useCallback((path: string) => forgetSession.current(path), []);

	const session = useSessionLifecycle({
		client,
		connectEpoch: host.connectEpoch,
		// 启动目录是本机的概念：远端主机上没有这个目录，打包态也可能压根没配
		projectDir: runtime.isLocal && bridge.projectDir.length > 0 ? bridge.projectDir : undefined,
		snapshot: runtime.workspace,
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

	/** 终端分页此刻显示哪一个终端；为空时从清单里挑一个 */
	const [activeTerminalId, setActiveTerminalId] = useState<string | undefined>(undefined);
	const terminalId =
		terminal.terminals.find((item) => item.id === activeTerminalId)?.id ??
		terminal.terminals[terminal.terminals.length - 1]?.id;

	/** 变更预览是否正在显示：右栏开着且停在变更标签上 */
	const isChangesVisible = shell.isPanelOpen && shell.panel.activeTab === "changes";
	/** 图谱看得见才取提交历史：它是低频的历史态，没人在看就不发请求 */
	const isHistoryVisible = shell.isPanelOpen && shell.panel.activeTab === "git-graph";

	const docs = useWorkspaceDocs({
		client,
		session: sessionView,
		snapshot: runtime.workspace,
		isChangesVisible,
		isHistoryVisible,
	});

	// 主机侧通知与插件的 ctx.ui.notify 都走轻提示：后台会话的提示也能被看见
	useNoticeBridge({ chat, session: sessionView, sessionId: openedSessionId, show: toast.show });

	const transcript = useTranscript({
		client,
		chat,
		activeFile: session.activeFile,
		openedSessionId,
	});

	// 删掉会话时把它的滚动位置一起收掉
	forgetSession.current = (path: string) => {
		transcript.forgetScroll(path);
	};

	useReadMarker({
		client,
		activeFile: session.activeFile,
		activity,
		refreshChanges: docs.refreshChanges,
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

	/** 开一个终端，把它摆到终端分页上。 */
	const openTerminal = useCallback(async () => {
		const info = await terminal.openTerminal();
		if (info !== undefined) {
			setActiveTerminalId(info.id);
			shell.setPanelTab("terminal");
		}
	}, [shell, terminal]);

	/** 各处复制都走这一份：只写剪贴板，成功与失败都不弹提示，反馈交给按钮自己的样子。 */
	const copyText = useCallback((text: string): void => {
		// 写失败也没有要说明的地方，接住 rejection 免得冒成未处理异常
		navigator.clipboard.writeText(text).catch(() => undefined);
	}, []);

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

	/*
	 * 工作区三件工具的快捷键：文件与变更直接打开对应标签，终端还没有实例时先在当前目录
	 * 新建一个。键位定义在 `workspace-shortcuts.ts`，启动清单与 `+` 菜单上的提示同源。
	 */
	const setPanelTab = shell.setPanelTab;
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent): void => {
			const tab = workspaceShortcutOf(event);
			if (tab === undefined) {
				return;
			}
			event.preventDefault();
			if (tab === "terminal" && terminalId === undefined) {
				void openTerminal();
				return;
			}
			setPanelTab(tab);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [openTerminal, setPanelTab, terminalId]);

	return (
		<>
			<Workbench
				host={host}
				session={session}
				shell={shell}
				docs={docs}
				terminal={terminal}
				composer={composer}
				transcript={transcript}
				languageSetting={languageSetting}
				onLanguageChange={onLanguageChange}
				openedSessionId={openedSessionId}
				terminalId={terminalId}
				copyText={copyText}
				openTerminal={openTerminal}
				composerInput={composerInput}
			/>
			{/* 整棵工作区只挂一份：可选中文本处给复制，对话正文另加引用 */}
			<TextMenu onCopy={copyText} onQuote={quoteInto} quoteScope={QUOTE_SOURCE_SELECTOR} />
		</>
	);
}
