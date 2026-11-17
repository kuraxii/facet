import {
	chatActivity,
	createTranscriptCache,
	type HostHandshake,
	SessionClient,
	TerminalClient,
	toTranscript,
} from "@facet/client-core";
import type { LanguageSetting, SupportedLanguage } from "@facet/i18n";
import type {
	FileContent,
	GitCommit,
	GitCommitDetail,
	GitCommits,
	GitFileChange,
	GitStatus,
	SlashCommand,
	TerminalInfo,
	ThinkingLevel,
} from "@facet/protocol";
import {
	DEFAULT_SETTINGS,
	type FacetSettings,
	type ModelInfo,
	type ProjectInfo,
	type SessionStatus,
	type SessionSummary,
} from "@facet/protocol";
import {
	ArrowDownIcon,
	baseName,
	ChangesDocument,
	ChangesPane,
	ChatOutline,
	ChatTranscript,
	CodeThemeProvider,
	Composer,
	CreateProjectDialog,
	changesTabId,
	clampSidebarWidth,
	commitTabId,
	DEFAULT_DARK_THEME,
	EmptyState,
	ExtensionPromptCard,
	endpointLabel,
	FilesPane,
	fileTabId,
	HostSwitcher,
	hasEndpoint,
	I18nProvider,
	isDarkTheme,
	type MainTab,
	type MainTabItem,
	MainTabs,
	normalizeEndpoint,
	normalizeUiScale,
	PanelTabs,
	PanelToggle,
	parseCommand,
	QueueStrip,
	RightPanel,
	type RightPanelState,
	readHostList,
	readPanelState,
	readSidebarWidth,
	resolveUiTheme,
	type SavedHost,
	type ScrollRestore,
	SessionSearch,
	SessionSidebar,
	type SettingsDataSource,
	SettingsPage,
	type SettingsSection,
	SidebarHeader,
	SidebarToggle,
	SshPasswordDialog,
	samePath,
	sessionTabId,
	sessionTitle,
	stepUiScale,
	THEME_MODES,
	type ThemeName,
	TrustDialog,
	terminalTabId,
	useI18n,
	useStickToBottom,
	writeHostList,
	writePanelState,
	writeSidebarWidth,
} from "@facet/ui";
import { FileView } from "@facet/ui-editor";
import type { TerminalAppearance } from "@facet/ui-terminal";
import { TerminalView } from "@facet/ui-terminal";
import { X } from "lucide-react";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { type HostChannelBridge, LOCAL_TARGET, makeTransport } from "./host-connection.ts";
import { blobFromBase64, encodeImage, IMAGE_MAX_BYTES, IMAGE_MIME_TYPES } from "./image-encode.ts";
import { readWindowControls, WindowControls } from "./WindowControls.tsx";

/** 一张选中的图片，字节以 base64 交回界面 */
interface PickedImageFile {
	readonly name: string;
	readonly mimeType: string;
	readonly data: string;
	readonly byteSize: number;
}

/** 预加载脚本注入的启动参数 */
interface FacetBridge extends HostChannelBridge {
	projectDir: string;
	platform: string;
	/** 应用版本 */
	appVersion: string;
	/** 当前窗口的界面缩放百分比 */
	uiScale: number;
	/** 设置本机界面缩放 */
	setUiScale?: (scale: number) => void;
	/** 本机保存的语言设置 */
	languageSetting: LanguageSetting;
	/** 主进程解析后的实际语言 */
	language: SupportedLanguage;
	/** 修改语言，返回实际使用的语言 */
	setLanguage: (setting: LanguageSetting) => Promise<SupportedLanguage>;
	/** 主机是本机管的（local），还是外面给的（external） */
	hostMode: string;
	/** 打开系统的目录选择窗口,取消时返回空 */
	pickDirectory: () => Promise<string | undefined>;
	/** 打开系统的选图窗口，取消时返回空数组 */
	pickImages: () => Promise<readonly PickedImageFile[]>;
	/** 用系统的保存窗口写一段文本,取消时返回 false */
	saveText: (suggestedName: string, text: string) => Promise<boolean>;
	/** 最小化窗口；浏览器端没有 */
	minimize?: () => void;
	/** 最大化与还原之间切换；浏览器端没有 */
	toggleMaximize?: () => void;
	/** 关闭窗口；浏览器端没有 */
	close?: () => void;
	/** 订阅最大化状态；浏览器端没有 */
	onWindowState?: (listener: (maximized: boolean) => void) => () => void;
}

declare global {
	interface Window {
		facet: FacetBridge;
	}
}

const bridge = window.facet;

/** 窄屏断点：880px 以下侧栏变抽屉，与样式表里的媒体查询保持一致。 */
const narrowQuery = window.matchMedia("(max-width: 880px)");

function subscribeResize(listener: () => void): () => void {
	narrowQuery.addEventListener("change", listener);
	return () => {
		narrowQuery.removeEventListener("change", listener);
	};
}

function readIsNarrow(): boolean {
	return narrowQuery.matches;
}

/** 取出各会话此刻的状态，侧栏按会话文件路径索引。 */
function statusesOf(client: SessionClient): ReadonlyMap<string, SessionStatus> {
	return new Map(client.store.sessionList().map((entry) => [entry.summary.path, entry.status]));
}

/**
 * 两份状态是否一样。
 *
 * 状态是对象，引用比不出版本差别，得逐字段比：流式期间这里每帧都会走到，判不等就会把
 * 侧栏的 memo 打断，等于没做优化。
 */
function sameStatus(left: SessionStatus, right: SessionStatus): boolean {
	if (
		left.activity !== right.activity ||
		left.pendingInput !== right.pendingInput ||
		left.seenAt !== right.seenAt
	) {
		return false;
	}
	if (left.settle === undefined || right.settle === undefined) {
		return left.settle === right.settle;
	}
	return (
		left.settle.at === right.settle.at &&
		left.settle.outcome === right.settle.outcome &&
		left.settle.message === right.settle.message
	);
}

/** 两份状态表是否一样。内容没变时沿用旧的引用，下游的 memo 才不会被无谓地打断。 */
function sameStatuses(
	left: ReadonlyMap<string, SessionStatus>,
	right: ReadonlyMap<string, SessionStatus>,
): boolean {
	if (left.size !== right.size) {
		return false;
	}
	for (const [key, value] of right) {
		const current = left.get(key);
		if (current === undefined || !sameStatus(current, value)) {
			return false;
		}
	}
	return true;
}

/** 两份会话清单是否一样。摘要对象在没变时是同一个引用，逐项比引用即可。 */
function sameSessions(left: readonly SessionSummary[], right: readonly SessionSummary[]): boolean {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < right.length; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

/** 外壳类名：抽屉展开时给 has-drawer，宽屏收起侧栏时给 is-sb-hidden。 */
function shellClassName(
	isSidebarOpen: boolean,
	isDrawerOpen: boolean,
	isSidebarCollapsed: boolean,
	isNarrow: boolean,
): string {
	const names = ["shell"];
	if (isNarrow && isDrawerOpen) {
		names.push("has-drawer");
	}
	if (!isNarrow && isSidebarCollapsed) {
		names.push("is-sb-hidden");
	}
	if (isSidebarOpen) {
		names.push("is-sb-open");
	}
	return names.join(" ");
}

/**
 * 应用外壳。
 *
 * 顶部那条 36px 的带是一行真正的布局行：左边一格放侧栏头部，中间一格放左栏开关，右边一格
 * 放右栏开关、分页与窗口按钮。下面才是三栏正文。带上的格子宽度与正文三栏共用
 * `--sidebar-width` 与 `--panel-width` 两个变量，所以不会各算各的。
 *
 * 连接中与连不上的界面只放窗口按钮，否则无边框窗口没有关闭入口。浏览器里没有窗口动作，
 * 拖动区与按钮都不渲染。
 */
function AppFrame({
	children,
	chrome,
	sidebarWidth = "272px",
	panelWidth = "0px",
}: {
	children: ReactNode;
	/** 顶带里的内容；不给时这条带只放窗口按钮 */
	chrome?: ReactNode;
	/** 侧栏当前宽度，收起时是 0 */
	sidebarWidth?: string;
	/** 右栏当前宽度，收起时是 0 */
	panelWidth?: string;
}): ReactNode {
	const controls = readWindowControls(bridge);
	const appRef = useRef<HTMLDivElement>(null);

	// 宽度只用两个变量表达，写在根节点上；拖动分隔条时由右栏直接改这两个变量，不经过渲染
	useEffect(() => {
		const element = appRef.current;
		if (element === null) {
			return;
		}
		element.style.setProperty("--sidebar-width", sidebarWidth);
		element.style.setProperty("--panel-width", panelWidth);
	}, [sidebarWidth, panelWidth]);

	return (
		<div className="app" ref={appRef}>
			{controls === undefined ? null : <div className="app-drag" />}
			<div className="app-chrome">
				{chrome ?? (
					<>
						<div className="chrome-slot is-main" />
						<div className="chrome-slot is-panel is-compact">
							<span className="chrome-spacer" />
							{controls === undefined ? null : <WindowControls controls={controls} />}
						</div>
					</>
				)}
			</div>
			{children}
		</div>
	);
}

/**
 * 当前要连的目标。
 *
 * 本机是固定标识，具体地址与令牌由主进程按发现文件给出；在清单里换主机时改这里，
 * 下一次 connect 就换目标。
 */
let hostTarget = LOCAL_TARGET;

/**
 * 本次连接要用的 SSH 密码。
 *
 * 由密码弹窗填进来，主进程收到后会自己留着供重连使用；这里只是把「这一次握手用哪个密码」
 * 交给通道，不落本地存储。
 */
let sshPassword: string | undefined;

const transport = makeTransport(
	bridge,
	() => hostTarget,
	() => sshPassword,
);
const client = new SessionClient({ transport, pageSize: 200, initialPages: 2 });
const terminalClient = new TerminalClient({ transport });

type Phase = "connecting" | "ready" | "failed";

/** 主题在本地保存键，主机上的设置读不到时先用它，避免启动时闪一下 */
const THEME_KEY = "facet.theme";

/** 草稿在本地保存的键 */
const DRAFTS_KEY = "facet.drafts";
/** 还没打开会话时草稿用的键 */
const NEW_DRAFT_KEY = "__new__";

/** 一张已经放进输入框、还没发出去的图片。 */
interface DraftImage {
	/** 本次输入内的稳定标识 */
	readonly id: string;
	/** 文件名，来自选择窗口、粘贴或拖拽 */
	readonly name: string;
	/** 媒体类型，发送时原样写进图片块 */
	readonly mimeType: string;
	/** 图片字节，发送那一刻才读成 base64 */
	readonly blob: Blob;
	/** 预览地址，objectURL */
	readonly previewUrl: string;
}

/** 没有待发图片时用的空列表，避免每帧新建数组 */
const EMPTY_IMAGES: readonly DraftImage[] = [];

/** 生成一张待发图片的标识。 */
function draftImageId(): string {
	return `img_${Math.random().toString(36).slice(2, 10)}`;
}

/** 读出保存的各会话草稿；读不懂时当作没有草稿。 */
function readDrafts(): Record<string, string> {
	try {
		const parsed: unknown = JSON.parse(localStorage.getItem(DRAFTS_KEY) ?? "{}");
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
			return {};
		}
		return Object.fromEntries(
			Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
		);
	} catch {
		return {};
	}
}

/** 系统是否偏浅色。 */
function prefersLight(): boolean {
	return window.matchMedia("(prefers-color-scheme: light)").matches;
}

/** 读取上次的主题，只用来在设置读到之前避免闪一下，缺省深色 */
function readTheme(): ThemeName {
	const stored = localStorage.getItem(THEME_KEY);
	const mode = THEME_MODES.find((candidate) => candidate === stored) ?? DEFAULT_DARK_THEME;
	return isDarkTheme(resolveUiTheme(mode, prefersLight())) ? "dark" : "light";
}

/**
 * 把外观设置写到根节点。
 *
 * 主题、字体与字号通过 CSS 变量下发，正文、代码块与差异视图都读同一组变量；减少动效时
 * 根节点带 data-motion="reduced"，样式据此关掉过渡。
 */
function applyAppearance(appearance: FacetSettings["appearance"]): void {
	const root = document.documentElement;
	root.dataset.theme = resolveUiTheme(appearance.theme, prefersLight());
	root.dataset.motion = appearance.reducedMotion ? "reduced" : "full";
	root.dataset.liveMotion = appearance.liveMotion;
	// 对话导航的所有尺寸都是 `--outline-scale` 的倍数，百分比在这里换算成倍数
	root.style.setProperty("--outline-scale", String(appearance.outlineScale / 100));
	// 界面字体与正文字号固定；整体大小由窗口缩放控制。
	// 空串表示用样式表里的缺省栈：这里把内联值去掉，`:root` 的默认值就生效；
	// 编辑器与终端的字体在样式表里默认跟着代码字体走
	const applyFont = (name: string, value: string): void => {
		const trimmed = value.trim();
		if (trimmed.length > 0) {
			root.style.setProperty(name, trimmed);
			return;
		}
		root.style.removeProperty(name);
	};
	applyFont("--font-mono", appearance.codeFont);
	applyFont("--font-editor", appearance.editorFont);
	applyFont("--font-terminal", appearance.terminalFont);
	root.style.setProperty("--editor-size", `${appearance.editorFontSize}px`);
	root.style.setProperty("--terminal-size", `${appearance.terminalFontSize}px`);
	localStorage.setItem(THEME_KEY, appearance.theme);
	// 编辑器与终端读的是计算后的变量值，换外观时要显式告诉它们重新取
	window.dispatchEvent(new Event("facet:appearance-changed"));
}

/**
 * 读一份终端外观。
 *
 * 字体与字号是 CSS 变量，xterm 只吃具体值，所以每次外观变化都要重新读一次计算样式；
 * 主题切换时前景、光标与选区色也跟着变，一并重读。
 */
function readTerminalAppearance(): TerminalAppearance {
	const styles = getComputedStyle(document.documentElement);
	const read = (name: string, fallback: string): string => styles.getPropertyValue(name).trim() || fallback;
	return {
		fontFamily: read("--font-terminal", "ui-monospace, monospace"),
		fontSize: Number.parseFloat(read("--terminal-size", "12.5")),
		lineHeight: 1.35,
		cursorBlink: true,
		scrollback: 5000,
		foreground: read("--t1", "#1a1a1e"),
		cursor: read("--acc", "#239956"),
		selection: read("--surface3", "#e4e4e7"),
	};
}

/** 把设置里的主题换成实际生效的深浅色，侧栏的切换按钮按它决定图标与文案。 */
function resolveTheme(mode: FacetSettings["appearance"]["theme"]): ThemeName {
	return isDarkTheme(resolveUiTheme(mode, prefersLight())) ? "dark" : "light";
}

/** 把一条项目并进列表：同一个标识就替换，没有就追加，保持原有顺序。 */
function mergeProject(list: readonly ProjectInfo[], project: ProjectInfo): ProjectInfo[] {
	const index = list.findIndex((item) => item.id === project.id);
	if (index < 0) {
		return [...list, project];
	}
	const next = [...list];
	next[index] = project;
	return next;
}

/** 启动时打开的会话：启动目录里最近更新的一条，没有则取全部会话里最近的一条。 */
function pickStartupSession(
	sessions: readonly SessionSummary[],
	projectDir: string,
): SessionSummary | undefined {
	let scoped: SessionSummary | undefined;
	let newest: SessionSummary | undefined;
	for (const session of sessions) {
		if (newest === undefined || session.modified > newest.modified) {
			newest = session;
		}
		if (!samePath(session.cwd, projectDir)) {
			continue;
		}
		if (scoped === undefined || session.modified > scoped.modified) {
			scoped = session;
		}
	}
	return scoped ?? newest;
}

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

/** 把项目内的相对路径拼成绝对路径。 */
function absoluteProjectPath(cwd: string, path: string): string {
	if (path.startsWith("/")) {
		return path;
	}
	return cwd.endsWith("/") ? `${cwd}${path}` : `${cwd}/${path}`;
}

function AppView({ languageSetting, onLanguageChange }: AppViewProps) {
	const { t } = useI18n();
	const version = useSyncExternalStore(
		(onChange) => client.store.subscribe(onChange),
		() => client.store.getVersion(),
	);
	const [phase, setPhase] = useState<Phase>("connecting");
	/** 当前连的主机端点，嵌入主机被重新拉起后会换 */
	const [endpoint, setEndpoint] = useState(LOCAL_TARGET);
	/** 与主机的连接是否可用，断开时输入区说明原因并禁用发送 */
	const [isOnline, setIsOnline] = useState(false);
	/** 正在自动重连：断线之后按退避重试，界面上写明状态 */
	const [isReconnecting, setIsReconnecting] = useState(false);
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const [sessions, setSessions] = useState<readonly SessionSummary[]>([]);
	/** 各会话在主机上的活动状态，侧栏的行首状态点用它 */
	const [statuses, setStatuses] = useState<ReadonlyMap<string, SessionStatus>>(() => new Map());
	const [activeFile, setActiveFile] = useState<string | undefined>(undefined);
	const [host, setHost] = useState<HostHandshake | undefined>(undefined);
	const [projects, setProjects] = useState<readonly ProjectInfo[]>([]);
	/** 项目列表上一次拉取失败，侧栏据此给出刷新入口 */
	const [isProjectsStale, setIsProjectsStale] = useState(false);
	const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
	const [createCwd, setCreateCwd] = useState(bridge.projectDir);
	/** 各会话的草稿，键为会话文件路径，新会话页面用 NEW_DRAFT_KEY */
	const [drafts, setDrafts] = useState<Record<string, string>>(readDrafts);
	/** 各草稿待发的图片，与文本草稿分开存：字节不进 localStorage */
	const [draftImages, setDraftImages] = useState<ReadonlyMap<string, readonly DraftImage[]>>(() => new Map());
	/** 被拒的图片给出的事实，例如超出大小上限 */
	const [imageNotice, setImageNotice] = useState<string | undefined>(undefined);
	/** 刚发出去那一批图片属于哪个草稿，主机确认后按它清空 */
	const sentImagesKey = useRef<string | undefined>(undefined);
	const [theme, setTheme] = useState<ThemeName>(readTheme);
	/** 主机上的偏好设置；没读到之前先用缺省值 */
	const [settings, setSettings] = useState<FacetSettings>(DEFAULT_SETTINGS);
	/** 本机界面缩放百分比，由主进程在创建窗口时带入 */
	const [uiScale, setUiScale] = useState(bridge.uiScale);
	/** 缩放变化后短暂显示的百分比浮层 */
	const [zoomBadge, setZoomBadge] = useState<number | undefined>(undefined);
	const zoomBadgeTimer = useRef<number | undefined>(undefined);
	/** 窄屏时侧栏是抽屉，这个开关控制它展开；宽屏时侧栏常驻，另行记收起的意图 */
	const [isDrawerOpen, setIsDrawerOpen] = useState(false);
	/** 侧栏头部那个会话搜索框是否展开；头部在顶带里，状态放在这里 */
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth(window.localStorage));
	// ⌘K 打开会话搜索，与页脚提示的快捷键一致
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setIsSearchOpen(true);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	const updateSidebarWidth = useCallback((next: number) => {
		const width = clampSidebarWidth(next);
		setSidebarWidth(width);
		writeSidebarWidth(window.localStorage, width);
	}, []);

	/** 应用本机界面缩放并让窗口重新测量。 */
	const changeUiScale = useCallback((next: number) => {
		const scale = normalizeUiScale(next);
		setUiScale(scale);
		bridge.setUiScale?.(scale);
		setZoomBadge(scale);
		if (zoomBadgeTimer.current !== undefined) window.clearTimeout(zoomBadgeTimer.current);
		zoomBadgeTimer.current = window.setTimeout(() => setZoomBadge(undefined), 1200);
		window.requestAnimationFrame(() => window.dispatchEvent(new Event("facet:zoom-changed")));
	}, []);

	// 界面缩放快捷键：Mod+= / Mod+- / Mod+0；0 回到 100%
	useEffect(() => {
		if (bridge.platform === "web") return;
		const onKeyDown = (event: KeyboardEvent) => {
			if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
			if (event.key === "0") {
				event.preventDefault();
				changeUiScale(100);
				return;
			}
			const direction =
				event.key === "=" || event.key === "+" ? 1 : event.key === "-" || event.key === "_" ? -1 : 0;
			if (direction === 0) return;
			event.preventDefault();
			changeUiScale(stepUiScale(uiScale, direction));
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [changeUiScale, uiScale]);

	useEffect(() => {
		return () => {
			if (zoomBadgeTimer.current !== undefined) window.clearTimeout(zoomBadgeTimer.current);
		};
	}, []);

	// Electron zoom 改变时 devicePixelRatio 跟着变；通知 xterm 与 CodeMirror 重新量字符网格
	useEffect(() => {
		let query: MediaQueryList | undefined;
		let dispose: (() => void) | undefined;
		const watch = (): void => {
			dispose?.();
			query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
			const onChange = (): void => {
				window.dispatchEvent(new Event("facet:zoom-changed"));
				watch();
			};
			query.addEventListener("change", onChange, { once: true });
			dispose = () => query?.removeEventListener("change", onChange);
		};
		watch();
		return () => dispose?.();
	}, []);
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
	/** 880px 以下走抽屉；侧栏开关在两套行为之间切换 */
	const isNarrow = useSyncExternalStore(subscribeResize, readIsNarrow);
	/** 窗口按钮；浏览器端没有。桥上的方法引用稳定，这个对象只要建一次 */
	const windowControls = useMemo(() => readWindowControls(bridge), []);
	const isSidebarOpen = isNarrow ? isDrawerOpen : !isSidebarCollapsed;
	const toggleSidebar = useCallback(() => {
		if (isNarrow) {
			setIsDrawerOpen((open) => !open);
		} else {
			setIsSidebarCollapsed((collapsed) => !collapsed);
		}
	}, [isNarrow]);
	/** 主区域显示对话还是设置 */
	const [view, setView] = useState<"chat" | "settings">("chat");
	/** 要问 SSH 密码的那台主机；undefined 表示没有弹窗 */
	const [passwordPrompt, setPasswordPrompt] = useState<
		{ target: string; host: string; isRetry: boolean } | undefined
	>(undefined);

	/** 主机清单：本机之外用户添加的远程主机，以及当前连着的端点 */
	const [hostList, setHostList] = useState(() => {
		const saved = readHostList(localStorage, LOCAL_TARGET);
		// 外部给了 FACET_ENDPOINT 就以它为准：上一次连的远程主机不该盖过这次显式指定的地址
		return bridge.hostMode === "external" ? { ...saved, activeEndpoint: LOCAL_TARGET } : saved;
	});

	/** 改主机清单并写回本地。 */
	const updateHostList = useCallback((next: typeof hostList) => {
		setHostList(next);
		writeHostList(localStorage, next);
	}, []);

	// 外部指定了端点时，把记着的那台改回来，别让下次启动被旧地址带着走
	useEffect(() => {
		if (bridge.hostMode === "external" && localStorage.getItem("facet.hosts.active") !== LOCAL_TARGET) {
			writeHostList(localStorage, { ...hostList, activeEndpoint: LOCAL_TARGET });
		}
	}, [hostList]);

	/** 右栏的状态；展开、分页与宽度都记在本地 */
	const [panel, setPanel] = useState<RightPanelState>(() => readPanelState(localStorage));

	/** 主区域已打开的标签：会话、文件、变更文档与终端 */
	const [mainTabs, setMainTabs] = useState<MainTab[]>([]);
	/** 当前主区域标签；为空时显示空状态 */
	const [activeTabId, setActiveTabId] = useState<string | undefined>(undefined);
	/** 用户主动关掉的会话标签，避免会话更新时又自动补回来 */
	const closedSessionTabIds = useRef(new Set<string>());
	/** 打开的文件内容，按主区域标签标识存 */
	const [fileContents, setFileContents] = useState<Readonly<Record<string, FileContent>>>({});
	/** 取文件失败的原因 */
	const [fileError, setFileError] = useState<string | undefined>(undefined);

	/** 变更页的数据：工作树状态、是否在取、失败原因 */
	const [changes, setChanges] = useState<{ status?: GitStatus; isLoading: boolean; error?: string }>({
		isLoading: false,
	});
	/** 变更请求的序号，只采用最后一次的结果 */
	const changesSeq = useRef(0);

	/** 提交历史的数据、加载状态与失败原因 */
	const [commits, setCommits] = useState<{
		data?: GitCommits;
		isLoading: boolean;
		error?: string;
	}>({ isLoading: false });

	/** 每个提交标签的改动详情 */
	const [commitDetails, setCommitDetails] = useState<
		Record<string, { detail?: GitCommitDetail; isLoading: boolean; error?: string }>
	>({});
	/** 每个提交标签的请求序号，避免旧结果覆盖新结果 */
	const commitRequests = useRef(new Map<string, number>());

	/** 输入区能用的命令：界面自带几条，加会话里的扩展、模板与技能 */
	const [commands, setCommands] = useState<SlashCommand[]>([]);

	/** 主机上的终端清单，含已结束的 */
	const [terminals, setTerminals] = useState<TerminalInfo[]>([]);
	/** 本端关掉的终端，避免清单还没刷新时又自动补回标签 */
	const closedTerminalIds = useRef(new Set<string>());
	/** 开终端失败的原因 */
	const [terminalError, setTerminalError] = useState<string | undefined>(undefined);

	/** 重新取终端清单。连不上或主机没有终端能力时按空处理。 */
	const refreshTerminals = useCallback(async (): Promise<TerminalInfo[]> => {
		try {
			const list = await terminalClient.list();
			setTerminals(list);
			return list;
		} catch {
			setTerminals([]);
			return [];
		}
	}, []);

	/** 连上主机之后：会话与终端都从这里开始收动作。 */
	const attachHost = useCallback(
		(handshake: HostHandshake) => {
			client.attach(handshake);
			terminalClient.start();
			void refreshTerminals();
		},
		[refreshTerminals],
	);

	/** 改右栏状态并写回本地存储。 */
	const updatePanel = useCallback((patch: Partial<RightPanelState>) => {
		setPanel((current) => {
			const next = { ...current, ...patch };
			writePanelState(localStorage, next);
			return next;
		});
	}, []);

	/** 打开或切到一个主区域标签；同一份内容只保留一个标签。 */
	const focusMainTab = useCallback((tab: MainTab) => {
		if (tab.kind === "session") {
			closedSessionTabIds.current.delete(tab.id);
		}
		setMainTabs((current) =>
			current.some((item) => item.id === tab.id)
				? current.map((item) => (item.id === tab.id ? tab : item))
				: [...current, tab],
		);
		setActiveTabId(tab.id);
	}, []);

	/** 收起一个主区域标签，并丢掉它保存的文件内容。 */
	const removeMainTab = useCallback((id: string) => {
		setMainTabs((current) => current.filter((item) => item.id !== id));
		setFileContents((current) => {
			const next = { ...current };
			delete next[id];
			return next;
		});
		setCommitDetails((current) => {
			if (!(id in current)) {
				return current;
			}
			const next = { ...current };
			delete next[id];
			return next;
		});
		commitRequests.current.delete(id);
		setActiveTabId((current) => (current === id ? undefined : current));
	}, []);

	/** 按拖动结果重排标签；标识对不上时保持原顺序。 */
	const reorderMainTabs = useCallback((ids: readonly string[]) => {
		setMainTabs((current) => {
			if (ids.length !== current.length) {
				return current;
			}
			const byId = new Map(current.map((tab) => [tab.id, tab]));
			const next: MainTab[] = [];
			for (const id of ids) {
				const tab = byId.get(id);
				if (tab === undefined) {
					return current;
				}
				next.push(tab);
			}
			return next.some((tab, index) => tab !== current[index]) ? next : current;
		});
	}, []);
	const [settingsSection, setSettingsSection] = useState<SettingsSection>("models");
	/** 打开、新建、分叉失败时的提示,带重试入口 */
	const [sessionError, setSessionError] = useState<{ message: string; retry: () => void } | undefined>(
		undefined,
	);
	/** 等待用户决定信任的目录,与决定之后要执行的动作 */
	const [trustPrompt, setTrustPrompt] = useState<{ cwd: string; run: () => void } | undefined>(undefined);
	const started = useRef(false);
	/** 会话切换的序号,只有最后一次选择的结果会落到界面上 */
	const switchSeq = useRef(0);
	/** 每个会话文件上次的滚动位置，切回标签时恢复 */
	const scrollPositions = useRef(new Map<string, ScrollRestore>());
	/** 正在进行的重连,重复触发时共用同一次 */
	const reconnecting = useRef<Promise<void> | undefined>(undefined);

	// 外观变化（含设置页里的预览）后重读终端那份计算样式。
	// 这段要排在下面应用外观的 effect 之前：启动时那次也要能接到。
	useEffect(() => {
		const onAppearance = (): void => setTerminalAppearance(readTerminalAppearance());
		window.addEventListener("facet:appearance-changed", onAppearance);
		return () => window.removeEventListener("facet:appearance-changed", onAppearance);
	}, []);

	// 设置变化时应用外观，并把有效主题同步给侧栏的切换按钮
	useEffect(() => {
		applyAppearance(settings.appearance);
		setTheme(resolveTheme(settings.appearance.theme));
	}, [settings.appearance]);

	const listSeq = useRef(0);

	/**
	 * 切换深浅色。
	 *
	 * 外观立刻生效，同时写回设置；写不进去时界面按新主题显示，下次启动回到原来的值。
	 */
	// 侧栏的快捷切换只在浅色与缺省深色之间来回，其余配色在设置页里选
	const toggleTheme = useCallback(() => {
		const next = theme === "dark" ? "light" : DEFAULT_DARK_THEME;
		setTheme(next === "light" ? "light" : "dark");
		const changed: FacetSettings = {
			...settings,
			appearance: { ...settings.appearance, theme: next },
		};
		setSettings(changed);
		applyAppearance(changed.appearance);
		void client.saveSettings(changed).catch(() => undefined);
	}, [settings, theme]);

	/**
	 * 拉一次全部会话。
	 *
	 * 平时靠主机推来的清单，这里用于启动、重连与用户手动刷新；清单通道补齐缺口时也会走
	 * 这条路。并发调用只采用最后一次的结果，避免旧结果覆盖新结果。
	 */
	const refreshSessions = useCallback(async (): Promise<readonly SessionSummary[] | undefined> => {
		listSeq.current += 1;
		const seq = listSeq.current;
		try {
			const pool = await client.refreshSessionList();
			if (seq === listSeq.current) {
				setSessions((current) => (sameSessions(current, pool) ? current : pool));
				const nextStatuses = statusesOf(client);
				setStatuses((current) => (sameStatuses(current, nextStatuses) ? current : nextStatuses));
			}
			return pool;
		} catch {
			// 列表刷新失败时保留已显示的会话,其他项目的历史不因此消失
			return undefined;
		}
	}, []);

	// 主机推来清单变化时侧栏跟着变，别的端新建、改名或删除会话这边立刻看到
	useEffect(
		() =>
			client.store.subscribe(() => {
				const pushed = client.store.sessionList();
				if (pushed.length > 0) {
					const next = pushed.map((entry) => entry.summary);
					setSessions((current) => (sameSessions(current, next) ? current : next));
				}
				// 流式期间每帧都会走到这里，状态没变就不换引用，侧栏因此不必重渲染
				const nextStatuses = statusesOf(client);
				setStatuses((current) => (sameStatuses(current, nextStatuses) ? current : nextStatuses));
			}),
		[],
	);

	/** 拉一次项目清单。失败只标脏,已经显示的项目保持原样。 */
	const refreshProjects = useCallback(async (): Promise<void> => {
		try {
			setProjects(await client.listProjects());
			setIsProjectsStale(false);
		} catch {
			setIsProjectsStale(true);
		}
	}, []);

	/**
	 * 重连主机。
	 *
	 * 断线之后按退避间隔一直试，连上就续订已打开的会话、重取会话状态与会话列表；同一个
	 * 时刻只跑一次，手动重试与自动重连共用这条路。
	 */
	/** 连接失败：缺密码就把密码框摆出来，其余情况回到「连不上主机」。 */
	const handleConnectError = useCallback((error: unknown, target: string, hadPassword: boolean): void => {
		const code = (error as { code?: unknown } | undefined)?.code;
		if (code === "need_password") {
			setPasswordPrompt({ target, host: endpointLabel(target), isRetry: hadPassword });
			setPhase("connecting");
			return;
		}
		setFailure(error instanceof Error ? error.message : String(error));
		setPhase("failed");
	}, []);

	const reconnect = useCallback(async (): Promise<void> => {
		setIsReconnecting(true);
		reconnecting.current ??= (async () => {
			let delay = 400;
			for (;;) {
				try {
					const handshake = await transport.connect();
					attachHost(handshake);
					setHost(handshake);
					// 会话回不来(例如它的文件已经不在了)时退回没有会话的状态,连接本身照常可用
					const resumed = await client.resume().then(
						() => true,
						() => false,
					);
					if (!resumed) {
						await client.release().catch(() => undefined);
						setActiveFile(undefined);
					}
					await refreshSessions();
					await refreshProjects();
					return;
				} catch (error) {
					// 缺密码时重试没有意义，停下来问一次
					if ((error as { code?: unknown } | undefined)?.code === "need_password") {
						handleConnectError(error, hostTarget, sshPassword !== undefined);
						return;
					}
					// 重连失败的原因留在控制台，便于排查连不上的问题
					console.log("[reconnect] Reconnect failed", error instanceof Error ? error.message : String(error));
					await new Promise((done) => setTimeout(done, delay));
					delay = Math.min(delay * 2, 8000);
				}
			}
		})()
			.catch(() => undefined)
			.finally(() => {
				reconnecting.current = undefined;
				setIsReconnecting(false);
			});
		await reconnecting.current;
	}, [refreshProjects, refreshSessions, attachHost, handleConnectError]);

	// 断线之后自动重连，期间输入区提示连接已断开
	useEffect(() => {
		if (!isOnline && phase === "ready") {
			void reconnect();
		}
	}, [isOnline, phase, reconnect]);

	// 本机主机重新拉起后端口与令牌都会变：按新的发现记录再握手，会话由 resume 续订
	useEffect(
		() =>
			bridge.onLocalHostChanged(() => {
				hostTarget = LOCAL_TARGET;
				setEndpoint(LOCAL_TARGET);
				// 会话还在屏幕上时不退回连接屏，只把状态换成「重连中」
				setPhase((current) => (current === "failed" ? "connecting" : current));
				void reconnect().then(
					() => setPhase("ready"),
					(error: unknown) => {
						setFailure(error instanceof Error ? error.message : String(error));
						setPhase("failed");
					},
				);
			}),
		[reconnect],
	);

	void version;

	const session = client.sessionView();
	/** 变更是否正在显示：右栏停在变更分页，或主区打开着变更文档 */
	const isChangesVisible =
		(panel.open && panel.tab === "changes") ||
		mainTabs.some((tab) => tab.id === activeTabId && tab.kind === "changes");
	/** 会话所在的目录，git 命令都在它下面跑 */
	const sessionCwd = session?.state.cwd;
	/** 当前会话对应的主区域标签 */
	const currentSessionTabId =
		session === undefined
			? undefined
			: sessionTabId(session.state.file, client.current?.snapshot.id ?? session.channel);

	// 会话打开或切换后，保证它有一个标签；首次打开时把焦点放到它上面
	useEffect(() => {
		if (session === undefined || currentSessionTabId === undefined) {
			return;
		}
		if (closedSessionTabIds.current.has(currentSessionTabId)) {
			return;
		}
		setMainTabs((current) =>
			current.some((item) => item.id === currentSessionTabId)
				? current
				: [
						...current,
						{
							id: currentSessionTabId,
							kind: "session",
							file: session.state.file,
							sessionId: client.current?.snapshot.id ?? session.channel,
						},
					],
		);
		setActiveTabId((current) => current ?? currentSessionTabId);
	}, [currentSessionTabId, session]);

	// 提交历史与变更状态跟着当前会话目录；换项目时丢掉旧列表并关掉对不上的变更标签
	useEffect(() => {
		changesSeq.current += 1;
		setCommits({ isLoading: false });
		setMainTabs((current) => {
			const next = current.filter(
				(tab) => tab.kind !== "changes" || (sessionCwd !== undefined && tab.cwd === sessionCwd),
			);
			return next.length === current.length ? current : next;
		});
	}, [sessionCwd]);

	// 标签被关掉后把焦点移到剩下的第一个，避免主区域空白
	useEffect(() => {
		if (mainTabs.length === 0) {
			setActiveTabId(undefined);
			return;
		}
		if (activeTabId === undefined || !mainTabs.some((item) => item.id === activeTabId)) {
			setActiveTabId(mainTabs[0]?.id);
		}
	}, [activeTabId, mainTabs]);

	// 主机上已经打开的终端都补成标签，不抢当前焦点
	useEffect(() => {
		const open = terminals.filter(
			(terminal) => !terminal.restored && !closedTerminalIds.current.has(terminal.id),
		);
		if (open.length === 0) {
			return;
		}
		setMainTabs((current) => {
			const missing = open.filter(
				(terminal) => !current.some((tab) => tab.kind === "terminal" && tab.terminalId === terminal.id),
			);
			if (missing.length === 0) {
				return current;
			}
			return [
				...current,
				...missing.map((terminal) => ({
					id: terminalTabId(terminal.id),
					kind: "terminal" as const,
					terminalId: terminal.id,
				})),
			];
		});
	}, [terminals]);

	const activeTab = mainTabs.find((item) => item.id === activeTabId);
	const changesTab = activeTab?.kind === "changes" ? activeTab : undefined;
	const commitTab = activeTab?.kind === "commit" ? activeTab : undefined;
	const commitDetail = commitTab === undefined ? undefined : commitDetails[commitTab.id];

	/** 终端能力：主机没装 pty 后端时不给入口 */
	const canUseTerminal = host?.capabilities.includes("terminal") ?? false;
	/** 新建终端的启动目录：跟着当前会话，没有会话时用第一个项目 */
	const terminalCwd = sessionCwd ?? projects[0]?.cwd;
	/** 终端不能用的原因，能用时为空 */
	const terminalDisabledReason = canUseTerminal ? undefined : t("app.terminalUnavailable");

	/**
	 * 终端外观：跟着界面配色与等宽字体走。
	 *
	 * 值只能从计算样式里读，所以每次换外观都要重新读一次；变化由 `facet:appearance-changed` 通知。
	 */
	const [terminalAppearance, setTerminalAppearance] = useState<TerminalAppearance>(readTerminalAppearance);

	/** 在当前目录开一个终端，并把它设成当前标签。 */
	const openTerminal = useCallback(async (): Promise<void> => {
		if (!canUseTerminal) {
			return;
		}
		setTerminalError(undefined);
		try {
			// 尺寸先给一个常用值，视图挂上之后 fit 出来的真实尺寸会再报一次
			const info = await terminalClient.create(terminalCwd, 100, 24);
			await refreshTerminals();
			focusMainTab({ id: terminalTabId(info.id), kind: "terminal", terminalId: info.id });
		} catch (error) {
			setTerminalError(error instanceof Error ? error.message : String(error));
		}
	}, [canUseTerminal, focusMainTab, refreshTerminals, terminalCwd]);

	/** 关掉一个终端标签，进程与清单一起收尾。 */
	const closeTerminal = useCallback(
		async (terminalId: string): Promise<void> => {
			closedTerminalIds.current.add(terminalId);
			removeMainTab(terminalTabId(terminalId));
			try {
				await terminalClient.kill(terminalId);
			} catch {
				// 已经结束的终端再关一次没有影响
			}
			await refreshTerminals();
		},
		[refreshTerminals, removeMainTab],
	);

	/** 关掉一个主区域标签；终端还要一并结束进程。 */
	const closeMainTab = useCallback(
		(id: string): void => {
			const tab = mainTabs.find((item) => item.id === id);
			if (tab?.kind === "session") {
				closedSessionTabIds.current.add(id);
				if (tab.file !== undefined) client.closeSession(tab.file);
			}
			if (tab?.kind === "terminal") {
				void closeTerminal(tab.terminalId);
				return;
			}
			removeMainTab(id);
		},
		[closeTerminal, mainTabs, removeMainTab],
	);

	/** 一次关闭多个标签；终端仍走单个关闭流程。 */
	const closeMainTabs = useCallback(
		(ids: readonly string[]): void => {
			for (const id of ids) {
				closeMainTab(id);
			}
		},
		[closeMainTab],
	);

	/** 标签菜单里的复制动作。 */
	const copyText = useCallback((text: string): void => {
		void navigator.clipboard.writeText(text).catch(() => undefined);
	}, []);

	// 快捷键 Ctrl + ` 回到终端标签；没有终端时在当前目录新建一个
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "`" || !(event.ctrlKey || event.metaKey)) {
				return;
			}
			event.preventDefault();
			const terminalTab = mainTabs.find((item) => item.kind === "terminal");
			if (terminalTab !== undefined) {
				setActiveTabId(terminalTab.id);
				return;
			}
			void openTerminal();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [mainTabs, openTerminal]);

	/** 打开一个文件：取内容后放进主区域标签。 */
	const openFile = useCallback(
		async (path: string): Promise<void> => {
			if (sessionCwd === undefined) {
				return;
			}
			const id = fileTabId(sessionCwd, path);
			setFileError(undefined);
			try {
				const content = await client.readFile(sessionCwd, path);
				setFileContents((current) => ({ ...current, [id]: content }));
				focusMainTab({ id, kind: "file", cwd: sessionCwd, path });
			} catch (error) {
				setFileError(error instanceof Error ? error.message : String(error));
			}
		},
		[focusMainTab, sessionCwd],
	);

	/** 把变更页里的一行打开到变更文档，并定位到该文件。 */
	const openDiff = useCallback(
		(file: GitFileChange): void => {
			if (sessionCwd === undefined) {
				return;
			}
			focusMainTab({
				id: changesTabId(sessionCwd),
				kind: "changes",
				cwd: sessionCwd,
				focusPath: file.path,
				focusRequestId: Date.now(),
			});
		},
		[focusMainTab, sessionCwd],
	);

	/** 取一次提交的改动详情；同一个标签的旧请求不会覆盖新结果。 */
	const loadCommit = useCallback(async (tabId: string, cwd: string, sha: string): Promise<void> => {
		const request = (commitRequests.current.get(tabId) ?? 0) + 1;
		commitRequests.current.set(tabId, request);
		setCommitDetails((current) => ({
			...current,
			[tabId]: { ...current[tabId], isLoading: true, error: undefined },
		}));
		try {
			const detail = await client.gitCommit(cwd, sha);
			if (commitRequests.current.get(tabId) === request) {
				setCommitDetails((current) => ({
					...current,
					[tabId]: { detail, isLoading: false },
				}));
			}
		} catch (error) {
			if (commitRequests.current.get(tabId) === request) {
				setCommitDetails((current) => ({
					...current,
					[tabId]: {
						detail: current[tabId]?.detail,
						isLoading: false,
						error: error instanceof Error ? error.message : String(error),
					},
				}));
			}
		}
	}, []);

	/** 打开一次提交的改动文档；同一提交只保留一个标签。 */
	const openCommit = useCallback(
		(commit: GitCommit): void => {
			if (sessionCwd === undefined) {
				return;
			}
			const tabId = commitTabId(sessionCwd, commit.sha);
			focusMainTab({
				id: tabId,
				kind: "commit",
				cwd: sessionCwd,
				sha: commit.sha,
				shortSha: commit.shortSha,
				subject: commit.subject,
			});
			const current = commitDetails[tabId];
			if (current?.isLoading !== true && (current?.detail === undefined || current.error !== undefined)) {
				void loadCommit(tabId, sessionCwd, commit.sha);
			}
		},
		[commitDetails, focusMainTab, loadCommit, sessionCwd],
	);

	// 换会话时清掉上一个会话留下的文件错误提示
	// biome-ignore lint/correctness/useExhaustiveDependencies: 只在会话变化时清空，状态设置函数不必列入
	useEffect(() => {
		setFileError(undefined);
	}, [activeFile]);

	/** 重新取工作树状态与提交历史。并发调用只采用最后一次的结果。 */
	const refreshChanges = useCallback(async (): Promise<void> => {
		if (sessionCwd === undefined) {
			return;
		}
		changesSeq.current += 1;
		const seq = changesSeq.current;
		setChanges((current) => ({ ...current, isLoading: true, error: undefined }));
		setCommits((current) => ({ ...current, isLoading: true, error: undefined }));
		const [statusResult, commitsResult] = await Promise.allSettled([
			client.gitStatus(sessionCwd),
			client.gitCommits(sessionCwd),
		]);
		if (seq !== changesSeq.current) {
			return;
		}
		if (statusResult.status === "fulfilled") {
			setChanges({ status: statusResult.value, isLoading: false });
		} else {
			setChanges({
				isLoading: false,
				error:
					statusResult.reason instanceof Error ? statusResult.reason.message : String(statusResult.reason),
			});
		}
		if (commitsResult.status === "fulfilled") {
			setCommits({ data: commitsResult.value, isLoading: false });
		} else {
			setCommits((current) => ({
				data: current.data,
				isLoading: false,
				error:
					commitsResult.reason instanceof Error ? commitsResult.reason.message : String(commitsResult.reason),
			}));
		}
	}, [sessionCwd]);

	// 展开变更页、切换会话、窗口重新获得焦点时各取一次（会话目录变化已含在 refreshChanges 里）
	useEffect(() => {
		if (isChangesVisible) {
			void refreshChanges();
		}
	}, [isChangesVisible, refreshChanges]);

	useEffect(() => {
		if (!isChangesVisible) {
			return;
		}
		const onFocus = (): void => void refreshChanges();
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [isChangesVisible, refreshChanges]);

	const chat = client.chatView();
	// 对话此刻的状态由会话状态得出,界面不自己拼布尔量
	const activity = chatActivity(session);

	// 一轮结束之后工作树可能变了，顺手再取一次
	const lastActivity = useRef(activity);
	useEffect(() => {
		if (lastActivity.current !== "idle" && activity === "idle") {
			// 前台看着结束时立刻记已读，侧栏不会先闪一下未读再变回去；
			// 窗口在后台时留着未读，等用户切回来再由聚焦事件清掉
			if (activeFile !== undefined && document.hasFocus()) {
				void client.markSessionsSeen([activeFile]).catch(() => undefined);
			}
			if (isChangesVisible) {
				void refreshChanges();
			}
		}
		lastActivity.current = activity;
	}, [activity, activeFile, isChangesVisible, refreshChanges]);

	// 从后台切回来时把当前会话记为已读：离开期间跑完的那一轮，回来后不该还挂着未读
	useEffect(() => {
		const onFocus = (): void => {
			if (activeFile !== undefined) {
				void client.markSessionsSeen([activeFile]).catch(() => undefined);
			}
		};
		window.addEventListener("focus", onFocus);
		return () => window.removeEventListener("focus", onFocus);
	}, [activeFile]);

	/** 主机的模型目录与各提供方的凭证状态，供输入区的模型选择使用。 */
	const [catalog, setCatalog] = useState<{ models: readonly ModelInfo[]; auth: Record<string, boolean> }>({
		models: [],
		auth: {},
	});
	/**
	 * 重取模型目录与各提供方的凭证状态。
	 *
	 * 设置里加过凭证或改过自定义提供方之后要再取一次，否则选择器还停在旧的可用清单上。
	 */
	const refreshCatalog = useCallback(async (): Promise<void> => {
		const [models, providers] = await Promise.all([
			client.listAvailableModels().catch(() => []),
			client.listProviders().catch(() => []),
		]);
		setCatalog({
			models,
			auth: Object.fromEntries(providers.map((provider) => [provider.id, provider.authenticated])),
		});
	}, []);

	/**
	 * 切到另一台主机。
	 *
	 * 先放掉当前会话并清空列表，再换端点重新握手：设置、模型目录、项目与会话都属于主机，
	 * 换过去之后整份重新取。连不上时交给重连逻辑退避重试，界面显示连不上主机那一屏。
	 */
	const switchHost = useCallback(
		async (nextEndpoint: string, password?: string): Promise<void> => {
			// 同一台主机带密码重来是「密码填错了再试一次」，不能挡
			if (nextEndpoint === endpoint && password === undefined) {
				setPasswordPrompt(undefined);
				return;
			}
			sshPassword = password;
			updateHostList({ ...hostList, activeEndpoint: nextEndpoint });
			setEndpoint(nextEndpoint);
			hostTarget = nextEndpoint;
			setActiveFile(undefined);
			setSessions([]);
			setProjects([]);
			setTerminals([]);
			closedTerminalIds.current.clear();
			scrollPositions.current.clear();
			setChanges({ isLoading: false });
			await client.release().catch(() => undefined);
			setMainTabs([]);
			setActiveTabId(undefined);
			setFileContents({});
			setPhase("connecting");
			// 只握一次手：连不上就直接回到「连不上主机」那一屏，重试按钮走退避重连
			try {
				const handshake = await transport.connect();
				attachHost(handshake);
				setHost(handshake);
				await client.resume().catch(() => undefined);
				await refreshSessions();
				await refreshProjects();
				setSettings(await client.getSettings().catch(() => DEFAULT_SETTINGS));
				await refreshCatalog();
				setPhase("ready");
			} catch (error) {
				handleConnectError(error, nextEndpoint, password !== undefined);
			}
		},
		[
			endpoint,
			hostList,
			refreshCatalog,
			refreshProjects,
			refreshSessions,
			updateHostList,
			attachHost,
			handleConnectError,
		],
	);

	/** 添加一台主机：地址收成端点，重复的直接回原因。 */
	const addHost = useCallback(
		(name: string, address: string): string | undefined => {
			const normalized = normalizeEndpoint(address);
			if (normalized === undefined) {
				return t("app.invalidAddress");
			}
			if (hasEndpoint(hostList, normalized, LOCAL_TARGET)) {
				return t("app.duplicateHost");
			}
			const host: SavedHost = {
				id: `${Date.now().toString(36)}-${hostList.hosts.length}`,
				name,
				endpoint: normalized,
			};
			updateHostList({ ...hostList, hosts: [...hostList.hosts, host] });
			return undefined;
		},
		[hostList, updateHostList, t],
	);

	/** 改一台远程主机的名字，名字从清单里读，不改连接。 */
	const renameHost = useCallback(
		(id: string, name: string): void => {
			const trimmed = name.trim();
			if (trimmed.length === 0) {
				return;
			}
			updateHostList({
				...hostList,
				hosts: hostList.hosts.map((host) => (host.id === id ? { ...host, name: trimmed } : host)),
			});
		},
		[hostList, updateHostList],
	);

	/** 从清单里删掉一台远程主机；删的是当前连接时回到本机。 */
	const removeHost = useCallback(
		(id: string): void => {
			const target = hostList.hosts.find((host) => host.id === id);
			updateHostList({ ...hostList, hosts: hostList.hosts.filter((host) => host.id !== id) });
			if (target !== undefined && target.endpoint === endpoint) {
				void switchHost(LOCAL_TARGET);
			}
		},
		[endpoint, hostList, switchHost, updateHostList],
	);

	const providerAuth = catalog.auth;

	/** 设置页的数据来源，接到主机上。 */
	const settingsData = useMemo<SettingsDataSource>(
		() => ({
			loadSettings: () => client.getSettings(),
			saveSettings: (next) => client.saveSettings(next),
			loadProviders: () => client.listProviders(),
			loadModels: () => client.listModels(),
			// 凭证与自定义提供方会改变可用模型，改完重取一次目录
			saveCredential: (providerId, apiKey) =>
				client.saveCredential(providerId, apiKey).then(async (providers) => {
					await refreshCatalog();
					return providers;
				}),
			deleteCredential: (providerId) =>
				client.deleteCredential(providerId).then(async (providers) => {
					await refreshCatalog();
					return providers;
				}),
			setProviderBaseUrl: (providerId, baseUrl) => client.setProviderBaseUrl(providerId, baseUrl),
			listCustomProviders: () => client.listCustomProviders(),
			saveCustomProvider: (provider) =>
				client.saveCustomProvider(provider).then(async (providers) => {
					await refreshCatalog();
					return providers;
				}),
			removeCustomProvider: (providerId) =>
				client.removeCustomProvider(providerId).then(async (providers) => {
					await refreshCatalog();
					return providers;
				}),
			testModel: (model) => client.testModel(model),
			diagnostics: () => client.diagnostics(),
			saveText: (suggestedName, text) => window.facet.saveText(suggestedName, text),
		}),
		[refreshCatalog],
	);

	/**
	 * 现在不能发送。
	 *
	 * 依次看连接、阶段与凭证：任何一条不满足都不该把消息送出去，草稿留在输入框里。界面上只
	 * 禁用发送按钮，不写一行说明。
	 */
	const draftKey = activeFile ?? NEW_DRAFT_KEY;
	const draft = drafts[draftKey] ?? "";
	/** 各草稿待发的图片，切回来还在；字节只在内存里，刷新即失效 */
	const pendingImages = draftImages.get(draftKey) ?? EMPTY_IMAGES;
	const draftCommand = parseCommand(draft.trim());
	const isExtensionCommand =
		draftCommand !== undefined &&
		commands.some((item) => item.source === "extension" && item.name === draftCommand.name);
	const isBlocked =
		!isOnline ||
		host?.role === "viewer" ||
		activity === "compacting" ||
		activity === "stopping" ||
		(session !== undefined && session.state.initialization.kind !== "ready") ||
		(session?.state.extensionUi.prompts.length ?? 0) > 0 ||
		(!isExtensionCommand &&
			(session?.state.model === undefined || providerAuth[session.state.model.provider] === false));
	const queued = session?.state.queued ?? { steering: [], followUp: [] };
	const canFork =
		activity === "idle" &&
		session?.state.maintenance === undefined &&
		session?.state.initialization.kind === "ready" &&
		session.state.extensionUi.prompts.length === 0;

	/**
	 * 跑一次会话切换类操作。
	 *
	 * 只采用最后一次选择的文件:后发起的操作会推进序号,先前那次的成功或失败都不再落到界面上。
	 * 失败留下带重试的提示,成功则清掉旧提示并刷新列表。
	 */
	const runSessionAction = useCallback(
		(
			action: () => Promise<string | undefined>,
			onDone?: (file: string | undefined) => void,
			options: { refresh?: boolean } = {},
		) => {
			switchSeq.current += 1;
			const seq = switchSeq.current;
			void (async () => {
				try {
					const file = await action();
					if (seq !== switchSeq.current) {
						return;
					}
					onDone?.(file);
					setActiveFile(file);
					setSessionError(undefined);
					if (options.refresh !== false) {
						await refreshSessions();
					}
				} catch (error) {
					if (seq !== switchSeq.current) {
						return;
					}
					setSessionError({
						message: error instanceof Error ? error.message : String(error),
						retry: () => runSessionAction(action, onDone, options),
					});
				}
			})();
		},
		[refreshSessions],
	);

	/**
	 * 先确认目录信任,再执行打开类动作。
	 *
	 * 目录里有项目级资源且还没做过决定时先问一次,决定之后再往下走;没有这类资源或已有决定
	 * 时直接执行。查询失败按未信任处理,不拦动作。
	 */
	const withTrust = useCallback((cwd: string | undefined, run: () => void) => {
		if (cwd === undefined) {
			run();
			return;
		}
		void (async () => {
			try {
				const state = await client.projectTrust(cwd);
				if (state.hasProjectResources && state.trusted === undefined) {
					setTrustPrompt({ cwd, run });
					return;
				}
			} catch {
				// 查不到就不拦,交给主机按未信任处理
			}
			run();
		})();
	}, []);

	/** 记下信任决定并继续被挡住的那次打开。 */
	const decideTrust = useCallback(
		(trusted: boolean) => {
			const prompt = trustPrompt;
			if (prompt === undefined) {
				return;
			}
			setTrustPrompt(undefined);
			void (async () => {
				try {
					await client.setProjectTrust(prompt.cwd, trusted);
				} catch {
					// 决定没记下时仍按未信任继续,下次打开会再问
				}
				prompt.run();
			})();
		},
		[trustPrompt],
	);

	const openSession = useCallback(
		(path: string, knownCwd?: string) => {
			const cached = client.hasSession(path);
			const run = (): void => {
				runSessionAction(
					async () => {
						await client.switchSession(path);
						return path;
					},
					(file) => {
						const opened = client.current;
						if (file === undefined || opened === undefined) {
							return;
						}
						focusMainTab({
							id: sessionTabId(file, opened.snapshot.id),
							kind: "session",
							file,
							sessionId: opened.snapshot.id,
						});
					},
				);
			};
			if (cached) {
				// 取消还在排队的打开结果，并让队列最后落回这个缓存会话
				switchSeq.current += 1;
				const opened = client.activateSession(path);
				if (opened !== undefined) {
					focusMainTab({
						id: sessionTabId(path, opened.snapshot.id),
						kind: "session",
						file: path,
						sessionId: opened.snapshot.id,
					});
					setActiveFile(path);
					setSessionError(undefined);
				}
				void client.switchSession(path).catch(() => undefined);
				void client.markSessionsSeen([path]).catch(() => undefined);
				return;
			}
			const cwd = knownCwd ?? sessions.find((session) => session.path === path)?.cwd;
			withTrust(cwd, run);
		},
		[focusMainTab, runSessionAction, sessions, withTrust],
	);

	/** 新建会话，默认模型交给 pi；这里只带界面的默认思考档位。 */
	const createSession = useCallback(
		(cwd: string) => {
			const thinkingLevel = settings.defaultThinkingLevel;
			withTrust(cwd, () => {
				runSessionAction(
					async () => {
						const opened = await client.createSession({
							...(cwd.length > 0 ? { cwd } : {}),
							...(thinkingLevel === undefined ? {} : { thinkingLevel }),
						});
						return opened.file;
					},
					(file) => {
						const opened = client.current;
						if (opened === undefined) {
							return;
						}
						focusMainTab({
							id: sessionTabId(file, opened.snapshot.id),
							kind: "session",
							file,
							sessionId: opened.snapshot.id,
						});
					},
				);
			});
		},
		[focusMainTab, runSessionAction, settings.defaultThinkingLevel, withTrust],
	);

	/**
	 * 侧栏与搜索要的回调。
	 *
	 * 它们依赖的会话操作用 useCallback 包了但依赖会变，直接用会让侧栏的 memo 每帧失效；
	 * 这里经 ref 转一层，侧栏拿到的始终是同一个函数。
	 */
	const openSessionRef = useRef(openSession);
	openSessionRef.current = openSession;
	const createSessionRef = useRef(createSession);
	createSessionRef.current = createSession;
	const selectSession = useCallback((path: string) => void openSessionRef.current(path), []);
	const createSessionAt = useCallback((cwd: string) => {
		setCreateCwd(cwd);
		void createSessionRef.current(cwd);
	}, []);
	const openAddProject = useCallback(() => setIsProjectDialogOpen(true), []);
	const openSearch = useCallback(() => {
		setIsDrawerOpen(false);
		setIsSearchOpen(true);
	}, []);
	const closeDrawer = useCallback(() => setIsDrawerOpen(false), []);
	const openSettingsView = useCallback(() => setView("settings"), []);
	const refreshProjectsNow = useCallback(() => void refreshProjects(), [refreshProjects]);

	// 连接状态：断开时输入区说明原因，恢复后自动放开
	useEffect(() => {
		setIsOnline(transport.state === "ready");
		return transport.onStateChange((state) => setIsOnline(state === "ready"));
	}, []);

	useEffect(() => {
		if (started.current) {
			return;
		}
		started.current = true;
		void (async () => {
			// 上次连的是远程主机时直接连回去，连不上会落到「连不上主机」那一屏
			const startEndpoint = hostList.activeEndpoint;
			if (startEndpoint !== LOCAL_TARGET) {
				hostTarget = startEndpoint;
				setEndpoint(startEndpoint);
			}
			const handshake = await transport.connect();
			attachHost(handshake);
			setHost(handshake);
			await refreshProjects();
			// 设置读不到时用缺省值，界面照常可用
			setSettings(await client.getSettings().catch(() => DEFAULT_SETTINGS));
			// 模型选择器只列可用的模型（已配置凭证的提供方），凭证状态仍用来标注当前模型
			await refreshCatalog();
			const pool = (await refreshSessions()) ?? [];
			const newest = pickStartupSession(pool, bridge.projectDir);
			if (newest) {
				openSession(newest.path, newest.cwd);
			}
			setPhase("ready");
		})().catch((error: unknown) => {
			setFailure(error instanceof Error ? error.message : String(error));
			setPhase("failed");
		});
	}, [hostList.activeEndpoint, openSession, refreshCatalog, refreshProjects, refreshSessions, attachHost]);

	/** 改当前草稿。延迟写入本地保存，切换会话时不丢。 */
	const updateDraft = useCallback(
		(change: string | ((current: string) => string)) => {
			setDrafts((current) => {
				const value = typeof change === "function" ? change(current[draftKey] ?? "") : change;
				const next = { ...current };
				if (value.length === 0) {
					delete next[draftKey];
				} else {
					next[draftKey] = value;
				}
				return next;
			});
		},
		[draftKey],
	);

	const editorUpdate = session?.state.extensionUi.editor;
	const editorSource =
		host === undefined || session === undefined
			? undefined
			: `facet.extensionEditor.${host.hostId}.${session.channel}`;
	const editorDraftKey = session?.state.file;
	useEffect(() => {
		if (
			editorUpdate === undefined ||
			editorSource === undefined ||
			editorDraftKey === undefined ||
			host?.role === "viewer"
		)
			return;
		if (localStorage.getItem(editorSource) === editorUpdate.id) return;
		setDrafts((current) => ({ ...current, [editorDraftKey]: editorUpdate.text }));
		localStorage.setItem(editorSource, editorUpdate.id);
	}, [editorUpdate, editorSource, editorDraftKey, host?.role]);

	// 草稿写进本地保存，重启之后还在
	useEffect(() => {
		localStorage.setItem(DRAFTS_KEY, JSON.stringify(drafts));
	}, [drafts]);

	/**
	 * 跑一条界面自己处理的命令。
	 *
	 * 这些命令在图形界面里有对应入口，就地执行，不当成消息发出去；参数不对时把说明留在
	 * 错误条上，草稿不丢。
	 */
	const runFacetCommand = useCallback(
		(name: string, args: string): boolean => {
			if (name === "compact") {
				client.compact();
				return true;
			}
			if (name === "model") {
				const [provider, id] = args.split("/");
				if (provider === undefined || id === undefined || provider.length === 0 || id.length === 0) {
					setSessionError({
						message: t("app.usageModel"),
						retry: () => {},
					});
					return true;
				}
				client.setModel({ provider, id });
				return true;
			}
			if (name === "thinking") {
				const level = args as ThinkingLevel;
				const allowed = session?.state.availableThinkingLevels ?? [];
				if (!allowed.includes(level)) {
					setSessionError({
						message:
							allowed.length === 0
								? t("app.noThinkingLevels")
								: t("app.availableLevels", { levels: allowed.join(" / ") }),
						retry: () => {},
					});
					return true;
				}
				client.setThinkingLevel(level);
				return true;
			}
			if (name === "name") {
				if (args.length === 0) {
					setSessionError({ message: t("app.usageName"), retry: () => {} });
					return true;
				}
				void client.renameSession(activeFile ?? "", args).then(
					() => void refreshSessions(),
					(error: unknown) => setSessionError({ message: String(error), retry: () => {} }),
				);
				return true;
			}
			return false;
		},
		[activeFile, refreshSessions, session?.state.availableThinkingLevels, t],
	);

	/** 把一批文件加入当前草稿的待发图片，越界与不受支持的逐个报出来。 */
	const addImages = useCallback(
		(files: readonly File[]) => {
			const accepted: DraftImage[] = [];
			const rejected: string[] = [];
			for (const file of files) {
				if (!(IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
					rejected.push(t("composer.imageUnsupported", { name: file.name }));
					continue;
				}
				if (file.size > IMAGE_MAX_BYTES) {
					rejected.push(
						t("composer.imageTooLarge", { name: file.name, limit: Math.round(IMAGE_MAX_BYTES / 1048576) }),
					);
					continue;
				}
				accepted.push({
					id: draftImageId(),
					name: file.name,
					mimeType: file.type,
					blob: file,
					previewUrl: URL.createObjectURL(file),
				});
			}
			setImageNotice(rejected.length === 0 ? undefined : rejected.join("、"));
			if (accepted.length === 0) {
				return;
			}
			setDraftImages((current) => {
				const next = new Map(current);
				next.set(draftKey, [...(next.get(draftKey) ?? []), ...accepted]);
				return next;
			});
		},
		[draftKey, t],
	);

	/** 打开系统的选图窗口，选中的内容在主进程已经读成 base64。 */
	const pickImages = useCallback(() => {
		void (async () => {
			const picked = await window.facet.pickImages().catch(() => []);
			if (picked.length === 0) {
				return;
			}
			addImages(
				picked.map(
					(item) => new File([blobFromBase64(item.data, item.mimeType)], item.name, { type: item.mimeType }),
				),
			);
		})();
	}, [addImages]);

	/** 丢掉一张待发图片，顺带释放它的预览地址。 */
	const removeImage = useCallback(
		(id: string) => {
			setDraftImages((current) => {
				const list = current.get(draftKey);
				const target = list?.find((item) => item.id === id);
				if (list === undefined || target === undefined) {
					return current;
				}
				URL.revokeObjectURL(target.previewUrl);
				const next = new Map(current);
				const rest = list.filter((item) => item.id !== id);
				if (rest.length === 0) {
					next.delete(draftKey);
				} else {
					next.set(draftKey, rest);
				}
				return next;
			});
			setImageNotice(undefined);
		},
		[draftKey],
	);

	/** 清掉某个草稿的全部待发图片，发送确认后调用。 */
	const clearImages = useCallback((key: string) => {
		setDraftImages((current) => {
			const list = current.get(key);
			if (list === undefined) {
				return current;
			}
			for (const item of list) {
				URL.revokeObjectURL(item.previewUrl);
			}
			const next = new Map(current);
			next.delete(key);
			return next;
		});
	}, []);

	const send = useCallback(() => {
		const text = draft.trim();
		if (text.length === 0 && pendingImages.length === 0) {
			return;
		}
		// 界面自己处理的命令就地执行，不当消息发出去；图片不参与命令
		const command = pendingImages.length === 0 ? parseCommand(text) : undefined;
		if (
			command !== undefined &&
			commands.some((item) => item.name === command.name && item.handler === "facet")
		) {
			if (runFacetCommand(command.name, command.args)) {
				updateDraft("");
			}
			return;
		}
		// 草稿留到主机确认再收,发送被拒时不用重打
		const key = draftKey;
		sentImagesKey.current = pendingImages.length === 0 ? undefined : key;
		void (async () => {
			const images = await Promise.all(pendingImages.map((item) => encodeImage(item)));
			if (activity === "running") {
				// 排队那条路只有文本，带图片时改走插入当前回合
				client.send(text, {
					streamingBehavior: "steer",
					...(images.length === 0 ? {} : { images }),
				});
				return;
			}
			client.send(text, images.length === 0 ? {} : { images });
		})();
	}, [activity, commands, draft, draftKey, pendingImages, runFacetCommand, updateDraft]);

	/**
	 * 收回排队内容:清空主机侧队列,把文字拼回输入框。
	 *
	 * 排队条来自 session/queueChanged,清空后主机会再推一次空队列,这里只改草稿。
	 */
	const takeBackQueue = useCallback(() => {
		const entries = [...queued.steering, ...queued.followUp];
		client.clearQueue();
		if (entries.length === 0) {
			return;
		}
		updateDraft((current) => {
			const restored = entries.join("\n\n");
			return current.trim().length === 0 ? restored : `${restored}\n\n${current}`;
		});
	}, [queued, updateDraft]);

	useEffect(() => {
		return client.onSent((text) => {
			// 只收掉刚发出的那段,等待期间新输入的内容保留
			updateDraft((current) => (current.trim() === text ? "" : current));
			const key = sentImagesKey.current;
			if (key !== undefined) {
				sentImagesKey.current = undefined;
				clearImages(key);
			}
		});
	}, [clearImages, updateDraft]);

	/**
	 * 回退到某条用户消息之前:从那一轮末尾分出新会话并切过去,把这条消息的文本放回输入框。
	 *
	 * pi 的会话文件只追加,回退靠分叉实现,原会话保持不动。
	 */
	const revertTo = useCallback(
		(entryId: string, text: string) => {
			// 回退在同一个会话里改分支指针，不新建会话；文本先放回输入框，历史由主机推的
			// chat/branchMoved 触发重装
			client.revert(entryId);
			updateDraft(() => text);
		},
		[updateDraft],
	);

	/**
	 * 添加项目。
	 *
	 * 添加接口返回的数据直接并进列表，后续的列表刷新失败只标脏，已经添加成功的项目不会
	 * 从侧栏消失；拉取会话失败同样不影响添加结果。
	 */
	/**
	 * 重试失败的一轮。
	 *
	 * 从这条用户消息之前分叉出新会话并立刻重发同一段文本:新会话里只有一份用户消息,失败
	 * 的那次调用留在原会话里,不会重复追加。
	 */
	const retryTurn = useCallback(
		(entryId: string, text: string) => {
			withTrust(session?.state.cwd, () => {
				runSessionAction(
					async () => (await client.fork(entryId)).file,
					() => {
						updateDraft(() => text);
						client.send(text);
					},
				);
			});
		},
		[runSessionAction, session?.state.cwd, updateDraft, withTrust],
	);

	const createProject = useCallback(
		async (input: { cwd: string; name: string | undefined }) => {
			const created = await client.addProject({
				cwd: input.cwd,
				...(input.name === undefined ? {} : { name: input.name }),
			});
			setProjects((current) => mergeProject(current, created));
			setCreateCwd(created.cwd);
			await refreshProjects();
			await refreshSessions();
		},
		[refreshProjects, refreshSessions],
	);

	/** 改名结果直接替换列表里那一条，名字在过滤器与新建提示里同步变化。 */
	const renameProject = useCallback(async (id: string, name: string | undefined) => {
		const updated = await client.renameProject(id, name);
		setProjects((current) => mergeProject(current, updated));
	}, []);

	/** 移除项目。会话文件与项目目录都不动，只从清单里去掉。 */
	const removeProject = useCallback(
		async (id: string) => {
			await client.removeProject(id);
			setProjects((current) => current.filter((item) => item.id !== id));
			await refreshProjects();
			await refreshSessions();
		},
		[refreshProjects, refreshSessions],
	);

	const revealProject = useCallback(async (id: string) => {
		await client.revealProject(id);
	}, []);

	/** 会话改名。改的是当前会话时名字会随会话状态一起推过来，列表在这里重拉一次。 */
	const renameSession = useCallback(
		async (path: string, name: string | undefined) => {
			await client.renameSession(path, name);
			await refreshSessions();
		},
		[refreshSessions],
	);

	/**
	 * 删除会话。
	 *
	 * 删的是当前打开的会话时，连接会连带释放，界面回到没有会话的状态，再重新拉起一个
	 * 可用的会话或落到空状态页。
	 */
	const deleteSession = useCallback(
		async (path: string) => {
			await client.deleteSession(path);
			scrollPositions.current.delete(path);
			setMainTabs((current) => current.filter((tab) => !(tab.kind === "session" && tab.file === path)));
			const pool = (await refreshSessions()) ?? [];
			if (activeFile !== path) {
				return;
			}
			setActiveFile(undefined);
			// 还有别的会话就切过去,一个都不剩时留在空状态页
			const next = pickStartupSession(pool, bridge.projectDir);
			if (next !== undefined) {
				openSession(next.path, next.cwd);
			}
		},
		[activeFile, openSession, refreshSessions],
	);

	const forkTurn = useCallback(
		(beforeEntryId: string | undefined) => {
			withTrust(session?.state.cwd, () => {
				runSessionAction(async () => (await client.fork(beforeEntryId)).file);
			});
		},
		[runSessionAction, session?.state.cwd, withTrust],
	);

	/** 没有打开会话时新建落在的目录：优先上次用过的，其次第一个项目。 */
	const emptyCreateCwd = createCwd.length > 0 ? createCwd : projects[0]?.cwd;
	/** 会话错误条，打开类操作失败时共用。 */
	const errorBar =
		sessionError === undefined ? null : (
			<div className="session-error">
				<span className="session-error-text">{sessionError.message}</span>
				<button type="button" className="btn" onClick={sessionError.retry}>
					{t("common.retry")}
				</button>
				<button
					type="button"
					className="ib"
					aria-label={t("app.closeNotice")}
					onClick={() => setSessionError(undefined)}
				>
					<X size={12} strokeWidth={1.5} />
				</button>
			</div>
		);

	// 换会话时重取命令清单：扩展、模板与技能都跟着会话走
	const openedSessionId = session === undefined ? undefined : client.current?.snapshot.id;
	useEffect(() => {
		if (openedSessionId === undefined || session?.state.initialization.kind !== "ready") {
			setCommands([]);
			return;
		}
		let cancelled = false;
		void client.listCommands().then(
			(list) => {
				if (!cancelled) {
					setCommands(list);
				}
			},
			() => {
				if (!cancelled) {
					setCommands([]);
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [openedSessionId, session?.state.initialization.kind]);

	const notices = [
		...new Map(
			[...(chat?.notices ?? []), ...(session?.state.extensionUi.notices ?? [])].map((notice) => [
				`${notice.level}:${notice.message}`,
				notice,
			]),
		).values(),
	];
	// 投影缓存按条目对象记忆：流式期间每帧只有末尾那条消息换新，其余条目直接沿用
	const transcriptCache = useRef(createTranscriptCache());
	const transcript = useMemo(() => (chat ? toTranscript(chat, transcriptCache.current) : []), [chat]);
	const restoreScroll = useCallback(
		(key: unknown): ScrollRestore | undefined =>
			typeof key === "string" ? scrollPositions.current.get(key) : undefined,
		[],
	);
	const {
		scrollRef,
		element: scrollElement,
		isPinned,
		scrollToBottom,
	} = useStickToBottom(transcript, activeFile, { restore: restoreScroll });

	// 记住每个会话的滚动位置，切回标签时恢复
	useEffect(() => {
		const element = scrollElement;
		if (element === null || activeFile === undefined) return;
		const save = (): void => {
			const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
			scrollPositions.current.set(activeFile, {
				top: element.scrollTop,
				atBottom: distance <= 24,
			});
		};
		save();
		element.addEventListener("scroll", save, { passive: true });
		return () => element.removeEventListener("scroll", save);
	}, [activeFile, scrollElement]);

	// 滚动到顶部时自动补更早的历史；已经在贴底时不触发，避免刚打开就连环加载。
	const loadingOlder = useRef(false);
	useEffect(() => {
		if (openedSessionId !== undefined) loadingOlder.current = false;
	}, [openedSessionId]);
	useEffect(() => {
		const element = scrollElement;
		if (element === null || isPinned) return;
		const loadOlder = () => {
			if (element.scrollTop > 96 || loadingOlder.current || !client.hasMore) return;
			loadingOlder.current = true;
			const distanceFromBottom = element.scrollHeight - element.scrollTop;
			void client.loadOlder().then(
				({ loaded }) => {
					if (loaded === 0) {
						loadingOlder.current = false;
						return;
					}
					requestAnimationFrame(() => {
						element.scrollTop = element.scrollHeight - distanceFromBottom;
						loadingOlder.current = false;
					});
				},
				() => {
					loadingOlder.current = false;
				},
			);
		};
		element.addEventListener("scroll", loadOlder, { passive: true });
		// 用户上一帧已经停在顶部时不会再触发 scroll，挂上监听后补一次判断
		loadOlder();
		return () => element.removeEventListener("scroll", loadOlder);
	}, [isPinned, scrollElement]);

	const codeThemeValue = useMemo(
		() => ({
			theme: settings.appearance.codeTheme,
			isDark: resolveTheme(settings.appearance.theme) === "dark",
		}),
		[settings.appearance.codeTheme, settings.appearance.theme],
	);

	const tabItems = useMemo<MainTabItem[]>(() => {
		return mainTabs.map((tab) => {
			if (tab.kind === "session") {
				const summary = sessions.find((item) => item.path === tab.file);
				const isCurrent =
					session !== undefined &&
					(session.state.file === tab.file ||
						(tab.file === undefined && (client.current?.snapshot.id ?? session.channel) === tab.sessionId));
				const name = isCurrent ? session.state.title : summary?.name;
				const label = sessionTitle(name, summary?.firstMessage ?? "", t("sidebar.untitled"));
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
					label: `${t("mainTabs.diff")} · ${baseName(tab.path)}`,
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
					label: t("mainTabs.changes"),
					title: tab.cwd,
					closable: true,
				};
			}
			if (tab.kind === "commit") {
				return {
					id: tab.id,
					kind: tab.kind,
					label: t("mainTabs.commit", { sha: tab.shortSha }),
					title: `${tab.shortSha} · ${tab.subject}`,
					closable: true,
				};
			}
			const terminal = terminals.find((item) => item.id === tab.terminalId);
			return {
				id: tab.id,
				kind: tab.kind,
				label: terminal === undefined ? t("terminal.newTerminal") : baseName(terminal.cwd),
				title: terminal === undefined ? tab.terminalId : `${terminal.shell} · ${terminal.cwd}`,
				closable: true,
			};
		});
	}, [mainTabs, session, sessions, t, terminals]);

	/** 切换标签；会话标签指向别的会话时先把它打开。 */
	const selectMainTab = useCallback(
		(id: string): void => {
			const tab = mainTabs.find((item) => item.id === id);
			if (tab === undefined) {
				return;
			}
			if (tab.kind !== "session") {
				setActiveTabId(id);
				return;
			}
			const isCurrent =
				session !== undefined &&
				(session.state.file === tab.file ||
					(tab.file === undefined && (client.current?.snapshot.id ?? session.channel) === tab.sessionId));
			if (isCurrent || tab.file === undefined) {
				setActiveTabId(id);
				return;
			}
			if (client.hasSession(tab.file)) {
				setActiveTabId(id);
			}
			openSession(tab.file);
		},
		[mainTabs, openSession, session],
	);

	const fileTab = activeTab?.kind === "file" ? activeTab : undefined;
	const terminalTab = activeTab?.kind === "terminal" ? activeTab : undefined;
	const fileContent = fileTab === undefined ? undefined : fileContents[fileTab.id];

	const passwordDialog =
		passwordPrompt === undefined ? null : (
			<SshPasswordDialog
				host={passwordPrompt.host}
				isRetry={passwordPrompt.isRetry}
				onSubmit={(password) => {
					const target = passwordPrompt.target;
					setPasswordPrompt(undefined);
					void switchHost(target, password);
				}}
				onCancel={() => {
					setPasswordPrompt(undefined);
					setFailure(t("app.passwordRequired"));
					setPhase("failed");
				}}
			/>
		);

	if (phase === "failed") {
		return (
			<AppFrame>
				<main className="boot">
					<h1>{t("app.connectFailed")}</h1>
					<p>{failure}</p>
					<p>{endpoint}</p>
					<div className="boot-hosts">
						<button
							type="button"
							className="boot-host"
							onClick={() => void switchHost(LOCAL_TARGET)}
							disabled={endpoint === LOCAL_TARGET}
						>
							{t("app.localHost")} · {endpointLabel(LOCAL_TARGET)}
						</button>
						{hostList.hosts.map((host) => (
							<button
								key={host.id}
								type="button"
								className="boot-host"
								onClick={() => void switchHost(host.endpoint)}
								disabled={endpoint === host.endpoint}
							>
								{host.name} · {endpointLabel(host.endpoint)}
							</button>
						))}
					</div>
					<button
						type="button"
						className="boot-retry"
						onClick={() => {
							setPhase("connecting");
							void reconnect().then(
								() => setPhase("ready"),
								(error: unknown) => handleConnectError(error, endpoint, sshPassword !== undefined),
							);
						}}
					>
						{t("common.retry")}
					</button>
				</main>
				{passwordDialog}
			</AppFrame>
		);
	}

	if (phase === "connecting") {
		return (
			<AppFrame>
				<main className="boot">
					<h1>{t("app.connecting")}</h1>
					<p>{endpoint}</p>
				</main>
				{passwordDialog}
			</AppFrame>
		);
	}

	return (
		<CodeThemeProvider value={codeThemeValue}>
			<AppFrame
				sidebarWidth={isSidebarOpen && !isNarrow ? `${sidebarWidth}px` : "0px"}
				panelWidth={panel.open ? `${panel.width}px` : "0px"}
				chrome={
					<>
						<div
							className={
								isNarrow || !isSidebarOpen ? "chrome-slot is-sidebar" : "chrome-slot is-sidebar is-open"
							}
						>
							{isNarrow || !isSidebarOpen ? null : (
								<SidebarHeader
									isSearchOpen={isSearchOpen}
									onToggleSearch={() => setIsSearchOpen((open) => !open)}
									onAddProject={() => setIsProjectDialogOpen(true)}
									onCollapse={toggleSidebar}
								/>
							)}
						</div>
						<div className="chrome-slot is-main">
							{/* 侧栏展开时开关在它自己的头部里，收起之后才回到主区左上角 */}
							{isNarrow ? (
								isDrawerOpen ? null : (
									<SidebarToggle isOpen={false} onToggle={toggleSidebar} />
								)
							) : isSidebarOpen ? null : (
								<SidebarToggle isOpen={false} onToggle={toggleSidebar} />
							)}
						</div>
						<div className={panel.open ? "chrome-slot is-panel is-open" : "chrome-slot is-panel is-compact"}>
							<PanelToggle isOpen={panel.open} onToggle={() => updatePanel({ open: !panel.open })} />
							{panel.open ? <PanelTabs tab={panel.tab} onTabChange={(tab) => updatePanel({ tab })} /> : null}
							<span className="chrome-spacer" />
							{windowControls === undefined ? null : <WindowControls controls={windowControls} />}
						</div>
					</>
				}
			>
				<div className={shellClassName(isSidebarOpen, isDrawerOpen, isSidebarCollapsed, isNarrow)}>
					{isDrawerOpen ? (
						<button
							type="button"
							className="sb-backdrop"
							aria-label={t("app.closeSidebar")}
							onClick={() => setIsDrawerOpen(false)}
						/>
					) : null}
					<SessionSidebar
						sessions={sessions}
						projects={projects}
						activeFile={activeFile}
						statuses={statuses}
						createCwd={createCwd}
						theme={theme}
						onSelect={selectSession}
						onCreate={createSessionAt}
						canCreate={phase === "ready"}
						onAddProject={openAddProject}
						isSearchOpen={isSearchOpen}
						onOpenSearch={openSearch}
						showHeader={isNarrow}
						width={isNarrow ? undefined : sidebarWidth}
						onWidthChange={isNarrow ? undefined : updateSidebarWidth}
						onCollapse={closeDrawer}
						isProjectsStale={isProjectsStale}
						onRefreshProjects={refreshProjectsNow}
						onRenameProject={renameProject}
						onRemoveProject={removeProject}
						onRevealProject={revealProject}
						onRenameSession={renameSession}
						onDeleteSession={deleteSession}
						onToggleTheme={toggleTheme}
						onOpenSettings={openSettingsView}
						isSettingsOpen={view === "settings"}
						hostStatus={
							isReconnecting ? t("app.reconnecting") : host?.role === "viewer" ? t("app.readOnly") : undefined
						}
						isOpen={isDrawerOpen}
						onNavigate={closeDrawer}
						hostSwitcher={
							<HostSwitcher
								localEndpoint={LOCAL_TARGET}
								localName={host?.hostName ?? t("app.localHost")}
								activeEndpoint={hostList.activeEndpoint}
								hosts={hostList.hosts}
								isOnline={isOnline}
								isReconnecting={isReconnecting}
								onConnect={(next) => void switchHost(next)}
								onAddHost={addHost}
								onRemoveHost={removeHost}
								onRenameHost={renameHost}
							/>
						}
					/>

					<main className="main">
						<MainTabs
							tabs={tabItems}
							activeId={activeTabId}
							onSelect={selectMainTab}
							onClose={closeMainTab}
							onCloseTabs={closeMainTabs}
							onCopyText={copyText}
							onReorder={reorderMainTabs}
							onCreateTerminal={() => void openTerminal()}
							canCreateTerminal={canUseTerminal}
							terminalDisabledReason={terminalDisabledReason}
						/>
						{terminalError === undefined ? null : (
							<p className="main-error">
								{terminalError}
								<button
									type="button"
									className="chg-retry"
									onClick={() => {
										setTerminalError(undefined);
										void openTerminal();
									}}
								>
									{t("common.retry")}
								</button>
							</p>
						)}
						<div className="main-tab-content" id="main-tab-content">
							{fileTab !== undefined ? (
								<section className="main-view is-file">
									{fileContent === undefined ? null : (
										<FileView
											key={fileTab.id}
											path={fileTab.path}
											content={fileContent}
											onSave={(text, expectedRevision) =>
												client.writeFile(fileTab.cwd, fileTab.path, text, expectedRevision)
											}
											onReload={async () => {
												const next = await client.readFile(fileTab.cwd, fileTab.path);
												setFileContents((current) => ({ ...current, [fileTab.id]: next }));
												return next;
											}}
										/>
									)}
								</section>
							) : commitTab !== undefined ? (
								<section className="main-view is-changes">
									<ChangesDocument
										key={commitTab.id}
										title={`${commitTab.shortSha} · ${commitTab.subject}`}
										emptyMessage={t("panel.noCommitChanges")}
										status={
											commitDetail?.detail === undefined
												? undefined
												: {
														isRepo: true,
														branch: commitTab.shortSha,
														files: commitDetail.detail.files,
													}
										}
										isLoading={commitDetail?.isLoading ?? true}
										error={commitDetail?.error}
										focusPath={undefined}
										focusRequestId={undefined}
										loadDiff={(file: GitFileChange) =>
											client.gitCommitDiff(commitTab.cwd, commitTab.sha, file.path, file.oldPath)
										}
										onRefresh={() => void loadCommit(commitTab.id, commitTab.cwd, commitTab.sha)}
										commits={undefined}
										commitsLoading={false}
										commitsError={undefined}
									/>
								</section>
							) : changesTab !== undefined ? (
								<section className="main-view is-changes">
									<ChangesDocument
										key={changesTab.id}
										status={changes.status}
										isLoading={changes.isLoading}
										error={changes.error}
										focusPath={changesTab.focusPath}
										focusRequestId={changesTab.focusRequestId}
										loadDiff={(file: GitFileChange) =>
											client.gitDiff(changesTab.cwd, file.path, file.status === "untracked")
										}
										onRefresh={() => void refreshChanges()}
										commits={commits.data}
										commitsLoading={commits.isLoading}
										commitsError={commits.error}
										onCommitPress={openCommit}
									/>
								</section>
							) : terminalTab !== undefined ? (
								<section className="main-view is-terminal">
									<TerminalView
										key={terminalTab.terminalId}
										terminalId={terminalTab.terminalId}
										client={terminalClient}
										appearance={terminalAppearance}
									/>
								</section>
							) : session === undefined ? (
								<div className="empty-wrap">
									{errorBar}
									<EmptyState
										cwd={emptyCreateCwd}
										canCreate={phase === "ready"}
										onCreate={() => {
											if (emptyCreateCwd !== undefined) {
												createSession(emptyCreateCwd);
											}
										}}
										onAddProject={() => setIsProjectDialogOpen(true)}
									/>
								</div>
							) : (
								<>
									<ChatOutline items={transcript} container={scrollElement} />
									<section className="scroll" ref={scrollRef}>
										<div className="column">
											<ChatTranscript
												items={transcript}
												canFork={canFork}
												onFork={forkTurn}
												canRevert={canFork}
												onRevert={revertTo}
												maintenance={session.state.maintenance}
												isRunning={activity !== "idle"}
												onRetryTurn={retryTurn}
												onCopyDetails={copyText}
												onCopyText={copyText}
												renames={chat?.renames}
												emptyHint={t("app.emptyHint")}
											/>
										</div>
									</section>

									<div className="footer">
										{isPinned ? null : (
											<button
												type="button"
												className="to-bottom"
												aria-label={t("app.backToBottom")}
												onClick={() => scrollToBottom("smooth")}
											>
												<ArrowDownIcon size={16} />
											</button>
										)}
										<div className="footer-column">
											{errorBar}
											{session.state.initialization.kind === "failed" ? (
												<p className="dialog-error">{session.state.initialization.message}</p>
											) : null}
											<QueueStrip queued={queued} onClear={takeBackQueue} />
											{session.state.extensionUi.prompts[0] === undefined ? null : (
												<ExtensionPromptCard
													key={`${host?.hostId}:${session.channel}:${session.state.extensionUi.prompts[0].requestId}`}
													prompt={session.state.extensionUi.prompts[0]}
													canRespond={isOnline && host?.role !== "viewer"}
													onRespond={async (response) => {
														await client.respondUi(
															session.state.extensionUi.prompts[0]?.requestId ?? "",
															response,
															openedSessionId,
														);
													}}
												/>
											)}
											<Composer
												value={draft}
												onChange={updateDraft}
												onSend={send}
												attachments={pendingImages.map((item) => ({
													id: item.id,
													name: item.name,
													previewUrl: item.previewUrl,
												}))}
												onPickImages={pickImages}
												onAddImages={addImages}
												canAddImages={session.state.model?.input.includes("image") ?? false}
												onRemoveAttachment={removeImage}
												attachmentNotice={imageNotice}
												onStop={() => client.cancel()}
												activity={activity}
												model={session.state.model}
												thinkingLevel={session.state.thinkingLevel}
												thinkingLevels={session.state.availableThinkingLevels}
												models={catalog.models}
												providerAuth={providerAuth}
												onModelChange={(next) => client.setModel({ provider: next.provider, id: next.id })}
												onThinkingLevelChange={(level) => client.setThinkingLevel(level)}
												shiftEnterToSend={settings.input.sendKey === "shiftEnter"}
												isBlocked={isBlocked}
												canStop={isOnline && host?.role !== "viewer"}
												contextUsage={session.state.contextUsage}
												isCompacting={activity === "compacting"}
												canCompact={activity === "idle"}
												onCompact={() => client.compact()}
												commands={commands}
												onRunCommand={(command, args) => {
													runFacetCommand(command.name, args);
												}}
											/>

											{notices.length > 0 ? (
												<div className="notices">
													{notices.map((notice) => (
														<span
															key={`${notice.level}:${notice.message}`}
															className={
																notice.level === "error"
																	? "chip is-error"
																	: notice.level === "warning"
																		? "chip is-warn"
																		: "chip"
															}
														>
															{notice.message}
														</span>
													))}
												</div>
											) : null}
										</div>
									</div>
								</>
							)}
						</div>
					</main>

					{panel.open ? (
						<RightPanel width={panel.width} onWidthChange={(width) => updatePanel({ width })}>
							{panel.tab === "changes" ? (
								<ChangesPane
									status={changes.status}
									isLoading={changes.isLoading}
									error={changes.error}
									onRefresh={() => void refreshChanges()}
									onOpenDiff={openDiff}
									commits={commits.data}
									commitsLoading={commits.isLoading}
									commitsError={commits.error}
									onCommitPress={openCommit}
								/>
							) : fileError === undefined ? (
								<FilesPane
									loadDirectory={(path) =>
										sessionCwd === undefined
											? Promise.reject(new Error(t("app.noSession")))
											: client.listDirectory(sessionCwd, path)
									}
									onOpenFile={(path) => void openFile(path)}
									selectedPath={
										fileTab !== undefined && fileTab.cwd === sessionCwd ? fileTab.path : undefined
									}
								/>
							) : (
								<p className="chg-note is-error">
									{fileError}
									<button type="button" className="chg-retry" onClick={() => setFileError(undefined)}>
										{t("editor.backToDirectory")}
									</button>
								</p>
							)}
						</RightPanel>
					) : null}

					<SessionSearch
						isOpen={isSearchOpen}
						sessions={sessions}
						activeFile={activeFile}
						statuses={statuses}
						onClose={() => setIsSearchOpen(false)}
						onSelect={selectSession}
					/>

					{view === "settings" ? (
						<SettingsPage
							section={settingsSection}
							onSectionChange={setSettingsSection}
							onClose={() => setView("chat")}
							data={settingsData}
							onSettingsApplied={setSettings}
							onAppearancePreview={(appearance) => {
								applyAppearance(appearance);
								setTheme(resolveTheme(appearance.theme));
							}}
							about={{
								appVersion: bridge.appVersion,
								runtime: `Electron ${bridge.platform}`,
								endpoint,
							}}
							uiScale={bridge.platform === "web" ? undefined : uiScale}
							onUiScaleChange={bridge.platform === "web" ? undefined : changeUiScale}
							languageSetting={languageSetting}
							onLanguageChange={onLanguageChange}
							// 浏览器入口改不了主机配置，桌面与 SSH 通道可以
							canEdit={host?.canManage === true}
						/>
					) : null}

					<CreateProjectDialog
						isOpen={isProjectDialogOpen}
						onPickFolder={() => window.facet.pickDirectory()}
						onCreate={createProject}
						onClose={() => setIsProjectDialogOpen(false)}
					/>

					{trustPrompt ? (
						<TrustDialog
							cwd={trustPrompt.cwd}
							onDecide={decideTrust}
							onCancel={() => setTrustPrompt(undefined)}
						/>
					) : null}
				</div>
			</AppFrame>
			{zoomBadge === undefined ? null : (
				<div className="zoom-badge" role="status">
					{zoomBadge}%
				</div>
			)}
		</CodeThemeProvider>
	);
}
