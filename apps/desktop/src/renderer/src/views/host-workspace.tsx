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
import type {
	AppearanceSettings,
	InputSettings,
	NotificationSettings,
	TerminalLocalSettings,
} from "@facet/protocol";
import { appendQuote, type ComposerHandle, TextMenu } from "@facet/ui";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { bridge } from "../bridge.ts";
import { useComposer } from "../hooks/useComposer.ts";
import type { HostConnection } from "../hooks/useHostConnection.ts";
import { useMentionFiles } from "../hooks/useMentionFiles.ts";
import { useMultiHostInbox } from "../hooks/useMultiHostInbox.ts";
import { useNoticeBridge } from "../hooks/useNoticeBridge.ts";
import { useSessionLifecycle } from "../hooks/useSessionLifecycle.ts";
import { useSystemNotifications } from "../hooks/useSystemNotifications.ts";
import { useTerminalPanel } from "../hooks/useTerminalPanel.ts";
import { useReadMarker, useTranscript } from "../hooks/useTranscript.ts";
import { useWorkspaceDocs } from "../hooks/useWorkspaceDocs.ts";
import { useWorkspaceShell } from "../hooks/useWorkspaceShell.ts";
import { useHostRegistry, useHostRuntime } from "../host-context.tsx";
import { hasLocalAppearance, hasLocalInput, workspaceStorage } from "../local-storage.ts";
import { QUOTE_SOURCE_SELECTOR } from "../selection-quote.ts";
import type { ActiveTarget } from "../session-target.ts";
import { useToast } from "../toast-provider.tsx";
import { workspaceShortcutOf } from "../workspace-shortcuts.ts";
import { Workbench } from "./workbench.tsx";

export interface HostWorkspaceProps {
	/** 当前目标主机的连接域 */
	host: HostConnection;
	/** 当前主工作区选中的跨主机目标 `(endpoint, file)` */
	activeTarget: ActiveTarget | undefined;
	/** 切换当前主工作区的目标会话 */
	onActiveTargetChange: (target: ActiveTarget | undefined) => void;
	/** 新建会话引导页选定的目标主机端点 */
	draftEndpoint: string;
	/** 切换新建会话引导页的目标主机端点 */
	onDraftEndpointChange: (endpoint: string) => void;
	/** 语言设置与切换 */
	languageSetting: LanguageSetting;
	onLanguageChange: (setting: LanguageSetting) => void;
	/** 本机优先的外观配置 */
	localAppearance: AppearanceSettings;
	onLocalAppearanceChange: (appearance: AppearanceSettings) => void;
	/** 本机优先的输入偏好 */
	localInput: InputSettings;
	onLocalInputChange: (input: InputSettings) => void;
	/** 本机优先的通知偏好 */
	localNotifications: NotificationSettings;
	onLocalNotificationsChange: (notifications: NotificationSettings) => void;
	/** 本机优先的终端交互偏好 */
	localTerminal: TerminalLocalSettings;
	onLocalTerminalChange: (terminal: TerminalLocalSettings) => void;
}

export function HostWorkspace({
	host,
	activeTarget,
	onActiveTargetChange,
	draftEndpoint,
	onDraftEndpointChange,
	languageSetting,
	onLanguageChange,
	localAppearance,
	onLocalAppearanceChange,
	localInput,
	onLocalInputChange,
	localNotifications,
	onLocalNotificationsChange,
	localTerminal,
	onLocalTerminalChange,
}: HostWorkspaceProps): React.JSX.Element {
	const toast = useToast();
	const hosts = useHostRegistry();
	const inbox = useMultiHostInbox(hosts);
	const runtime = useHostRuntime();
	const client = runtime.client;
	const terminalClient = runtime.terminalClient;
	const wsStorage = useMemo(() => workspaceStorage(host.endpoint), [host.endpoint]);
	const version = useSyncExternalStore(
		(onChange) => client.store.subscribe(onChange),
		() => client.store.getVersion(),
	);
	void version;

	// 首次升级迁移：如果本机尚未落盘过外观或输入偏好，则从本机服务端继承一次作为初始值，此后始终本机优先
	useEffect(() => {
		if (!runtime.isLocal || host.phase !== "ready") {
			return;
		}
		if (!hasLocalAppearance()) {
			onLocalAppearanceChange(host.settings.appearance);
		}
		if (!hasLocalInput()) {
			onLocalInputChange(host.settings.input);
		}
	}, [
		host.phase,
		host.settings.appearance,
		host.settings.input,
		onLocalAppearanceChange,
		onLocalInputChange,
		runtime.isLocal,
	]);

	/** 删掉会话之后的收尾：滚动位置与草稿在之后建好，这里经 ref 转一层。 */
	const forgetSession = useRef<(path: string) => void>(() => undefined);
	const onSessionRemoved = useCallback((path: string) => forgetSession.current(path), []);

	const session = useSessionLifecycle({
		client,
		connectEpoch: host.connectEpoch,
		// 启动目录是本机的概念：远端主机上没有这个目录，打包态也可能压根没配
		projectDir: runtime.isLocal && bridge.projectDir.length > 0 ? bridge.projectDir : undefined,
		snapshot: runtime.workspace,
		storage: wsStorage,
		targetFile: activeTarget?.endpoint === host.endpoint ? activeTarget.file : undefined,
		onActiveFileChange: (file) => {
			onActiveTargetChange(file === undefined ? undefined : { endpoint: host.endpoint, file });
		},
		onSessionRemoved,
	});

	// 系统通知只订阅这台主机的会话：换主机时这棵子树整份卸载，订阅也跟着换；
	// 点通知后切到那个会话，走的是侧栏同一个入口
	useSystemNotifications({ client, onOpen: session.selectSession, settings: localNotifications });

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
	/** 新建会话引导页选中的项目目录（undefined 表示未关联项目） */
	const [draftCwd, setDraftCwd] = useState<string | undefined>(undefined);
	const effectiveCwd = sessionCwd ?? draftCwd;
	/** 终端能力：主机没装 pty 后端时不给入口 */
	const canUseTerminal = host.host?.capabilities.includes("terminal") ?? false;
	/** 新建终端的启动目录：依次取当前会话目录、首个项目目录、已保存的新建目录 */
	const terminalCwd =
		sessionCwd ?? session.projects[0]?.cwd ?? (session.createCwd.length > 0 ? session.createCwd : undefined);

	const shell = useWorkspaceShell({ appearance: localAppearance, endpoint: host.endpoint });

	const terminal = useTerminalPanel({
		client: terminalClient,
		canUseTerminal,
		cwd: terminalCwd,
		connectEpoch: host.connectEpoch,
		snapshot: runtime.workspace,
		showToast: toast.show,
		localTerminal,
		autoOpen: shell.isPanelOpen && shell.panel.activeTab === "terminal",
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
		storage: wsStorage,
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

	const composer = useComposer({
		client,
		session: sessionView,
		openedSessionId,
		activeFile: session.activeFile,
		activity,
		host: host.host,
		storage: wsStorage,
		setSessionError: session.setSessionError,
		withTrust: session.withTrust,
		runSessionAction: session.runSessionAction,
		refreshSessions: session.refreshSessions,
	});

	// 删掉会话时把它的滚动位置与未发草稿一起收掉
	forgetSession.current = (path: string) => {
		transcript.forgetScroll(path);
		composer.forgetDraft(path);
	};

	useReadMarker({
		client,
		activeFile: session.activeFile,
		activity,
		refreshChanges: docs.refreshChanges,
		isChangesVisible,
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

	/** 输入区的命令式句柄：引用之后由编辑器自己插结构、落光标 */
	const composerInput = useRef<ComposerHandle>(null);
	/**
	 * 把选中的文字做成引用块接进草稿。
	 *
	 * 输入区在的时候把动作交给编辑器：它直接插引用块节点，光标落进引用下方的新段落，
	 * 撤销历史与选区都跟着走。没有句柄（编辑器还没挂上）时才退回字符串拼接。
	 */
	const quoteInto = useCallback(
		(text: string): void => {
			const handle = composerInput.current;
			if (handle !== null) {
				handle.appendQuote(text);
				return;
			}
			composer.updateDraft((current) => appendQuote(current, text));
		},
		[composer],
	);

	/** `@` 补全的文件清单：跟着当前会话或引导页所选项目目录走 */
	const mentionFiles = useMentionFiles(client, effectiveCwd);

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
			if (tab === "browser" && bridge.browser === undefined) {
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
				localAppearance={localAppearance}
				onLocalAppearanceChange={onLocalAppearanceChange}
				localInput={localInput}
				onLocalInputChange={onLocalInputChange}
				localNotifications={localNotifications}
				onLocalNotificationsChange={onLocalNotificationsChange}
				localTerminal={localTerminal}
				onLocalTerminalChange={onLocalTerminalChange}
				workspaceStorage={wsStorage}
				openedSessionId={openedSessionId}
				terminalId={terminalId}
				copyText={copyText}
				openTerminal={openTerminal}
				composerInput={composerInput}
				mentionFiles={mentionFiles}
				draftCwd={draftCwd}
				onDraftCwdChange={setDraftCwd}
				hosts={hosts}
				inbox={inbox}
				activeTarget={activeTarget}
				onActiveTargetChange={onActiveTargetChange}
				draftEndpoint={draftEndpoint}
				onDraftEndpointChange={onDraftEndpointChange}
			/>
			{/* 整棵工作区只挂一份：可选中文本处给复制，对话正文另加引用 */}
			<TextMenu onCopy={copyText} onQuote={quoteInto} quoteScope={QUOTE_SOURCE_SELECTOR} />
		</>
	);
}
