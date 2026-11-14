/**
 * 线格式。
 *
 * 连接建立后主机先发 hello(带本次连接分配的端标识与协议版本),之后端点发请求、主机回响应。
 * 状态变更一律走 action 帧,按通道定序并可回放;请求只用于查询与生命周期,写操作没有响应,
 * 被拒时以带 rejectionReason 的 action 帧回给发起方。
 */
import type { Action, ActionOrigin } from "./action.ts";
import type { Channel } from "./channel.ts";
import type { SlashCommand } from "./command.ts";
import type { FileContent, FileEntry, FileWriteResult } from "./file.ts";
import type { GitDiff, GitStatus } from "./git.ts";
import type {
	CustomProviderInfo,
	CustomProviderInput,
	ModelInfo,
	ModelRef,
	ProviderInfo,
	ThinkingLevel,
} from "./model.ts";
import type { ProjectInfo } from "./project.ts";
import type { Entry, SessionSnapshot, SessionSummary } from "./session.ts";
import type { FacetSettings } from "./settings.ts";
import type { TerminalInfo } from "./terminal.ts";

/** 线格式版本。不兼容的改动递增此值,端点据此拒绝握手。 */
export const PROTOCOL_VERSION = 1;

/** 主机上报的能力标记,端点据此隐藏不可用的入口。 */
export type Capability = "dispatch" | "tools" | "compaction" | "terminal";

/**
 * 这条连接的权限档。
 *
 * admin 是本机连接，能改设置与凭证、增删项目、结束主机；operator 是允许操作项目的远程
 * 连接，能发消息、停止与应答交互；viewer 是只读的远程连接，只能看。
 */
export type ClientRole = "admin" | "operator" | "viewer";

/**
 * 连接从哪一端发起。
 *
 * desktop 是桌面主进程打开的通道，可能是本机 socket，也可能是 SSH 隧道；web 是浏览器页面里
 * 直接连的 WebSocket。凭证、设置与项目清单只在 desktop 入口放行：SSH 已经是一道认证，浏览器
 * 只有一个令牌。
 */
export type ClientEntry = "desktop" | "web";

/** 请求失败的分类。端点按 code 决定提示方式,message 仅用于展示与日志。 */
export type ErrorCode =
	/** 方法名未知或该版本不支持 */
	| "unknown_method"
	/** 参数缺失或结构不符 */
	| "bad_params"
	/** 通道 URI 无法解析或该通道未实现 */
	| "unknown_channel"
	/** 会话不存在或已被释放 */
	| "unknown_session"
	/** 主机侧拒绝执行,例如会话正在运行而动作未指定投递方式 */
	| "rejected"
	/** 文件或目录不存在 */
	| "file_not_found"
	/** 路径不在项目根内，含符号链接指到根外 */
	| "outside_project"
	/** 目标不是文件 */
	| "not_a_file"
	/** 目标不是目录 */
	| "not_a_directory"
	/** 文件超过读写上限 */
	| "file_too_large"
	/** 文件在磁盘上已被改动，与预期版本不一致 */
	| "file_conflict"
	/** 主机侧内部错误 */
	| "internal";

/** 失败详情。 */
export interface ProtocolError {
	code: ErrorCode;
	message: string;
}

/** 连接建立后主机立即发出的首帧。 */
export interface HelloFrame {
	type: "hello";
	protocolVersion: number;
	/** 主机标识,同一次进程运行内保持不变 */
	hostId: string;
	/** 主机展示名 */
	hostName: string;
	/** 本次连接分配的端标识,派发动作时主机把它回填到 origin */
	clientId: string;
	/** 这条连接能做什么 */
	role: ClientRole;
	/** 这条连接能不能改设置、凭证与项目清单这类主机配置 */
	canManage: boolean;
	/** 主机实际生效的 pi 数据目录，远端排查时看它 */
	agentDir: string;
	capabilities: Capability[];
}

/**
 * 连接建立后的第一帧。
 *
 * 主机校验通过才发 hello；令牌不对直接断开，端点拿不到 hello 也就无法发请求。
 * 不设令牌的主机用 `withoutToken` 显式声明，用来隔离本地调试环境。
 */
export interface AuthFrame {
	type: "auth";
	token: string;
	/**
	 * 请求的权限档。
	 *
	 * 缺省按管理档处理（本机连接）；远程端自己声明要只读还是操作档，主机会按自己的配置
	 * 收窄。能拿到令牌就等于能用这台主机，所以这里限制的是操作习惯，不是安全边界。
	 */
	role?: "operator" | "viewer";
	/**
	 * 连接来源，缺省按 desktop 算。
	 *
	 * 浏览器里那套界面自己声明 web；桌面主进程与它的 SSH 通道不声明。
	 */
	entry?: ClientEntry;
}

/** 端点发出的请求。id 由端点生成,响应原样带回。 */
export interface RequestFrame {
	type: "request";
	/** 请求 id,同一连接内唯一 */
	id: string;
	method: RequestMethod;
	params?: unknown;
}

/** 主机对请求的应答。ok 为 false 时带错误详情。 */
export type ResponseFrame =
	| { type: "response"; id: string; ok: true; data: unknown }
	| { type: "response"; id: string; ok: false; error: ProtocolError };

/**
 * 端点派发的动作。
 *
 * clientSeq 由端点自己递增,主机把它连同 clientId 写进回放的 origin,
 * 端点重连后据此对账,避免同一条动作生效两次。
 */
export interface DispatchFrame {
	type: "dispatch";
	channel: Channel;
	clientSeq: number;
	action: Action;
}

/** 主机推送的动作帧。 */
export interface ActionFrame {
	type: "action";
	channel: Channel;
	action: Action;
	/** 通道内的递增序号,从 1 开始 */
	serverSeq: number;
	/** 动作来源,缺省表示主机侧产生 */
	origin: ActionOrigin | undefined;
	/** 主机拒绝该动作时的说明;出现即表示该动作未被应用 */
	rejectionReason?: string;
}

/** 主机发往端点的帧。 */
export type ServerFrame = HelloFrame | ResponseFrame | ActionFrame;

/** 端点发往主机的帧。 */
export type ClientFrame = AuthFrame | RequestFrame | DispatchFrame;

/** 订阅结果。 */
export interface SubscribeResult {
	/** 订阅完成时的通道序号 */
	seq: number;
	/** 为真表示 since 之后的部分动作已不在缓冲内,端点需要重新读取快照与历史 */
	resync: boolean;
	/** 订阅会话通道时返回会话快照;对话通道不返回,历史经 entries 分页取得 */
	session?: SessionSnapshot;
}

/** 每条请求的参数。 */
export interface RequestParams {
	/** 列出会话。指定 cwd 时只列该目录。 */
	listSessions: { cwd?: string };
	/** 列出某个会话里能用的命令：界面自带的几条，加上扩展命令、提示词模板与技能。 */
	listCommands: { sessionId: string };
	/** 列出正在运行的会话文件。退出前确认有没有任务会被带走。 */
	busySessions: Record<string, never>;
	/** 结束主机：应答后关闭端点并退出进程。只接受来自回环地址的连接。 */
	/** 新建会话并返回初始快照。 */
	createSession: {
		cwd?: string;
		model?: ModelRef;
		thinkingLevel?: ThinkingLevel;
		tools?: string[];
		excludeTools?: string[];
		name?: string;
	};
	/** 打开已有会话并返回初始快照。 */
	openSession: { sessionFile: string; cwd?: string };
	/**
	 * 分叉出新会话，返回新会话的初始快照。
	 *
	 * beforeEntryId 给出时复制到它之前的那个条目为止，界面用它按轮分叉；缺省时复制整条
	 * 活动分支，也就是把当前对话整段带到新会话。
	 */
	forkSession: { sessionFile: string; beforeEntryId?: string; cwd?: string };
	/** 取会话当前状态。 */
	snapshot: { sessionId: string };
	/**
	 * 分页读取历史,从 cursor 指向的条目往更早取 limit 条。
	 *
	 * 点对点请求,不广播:一个端点拉历史不影响到其他端点,主机侧也不必为此增长状态。
	 * nextCursor 缺省表示已经到最早。limit 缺省由主机决定。
	 */
	entries: { sessionId: string; cursor?: string; limit?: number };
	/**
	 * 取 afterEntryId 之后到叶子的条目,按从早到晚排列。
	 *
	 * 端点在本轮 settled 之后用它把实时消息提升为历史消息:主机从叶子沿 parentId 往回
	 * 走到 afterEntryId,再把这一段反转返回。afterEntryId 缺省表示整条分支。
	 * afterEntryId 不在活动分支上时主机侧拒绝,端点据此重新装载历史。
	 */
	entriesAfter: { sessionId: string; afterEntryId?: string };
	/** 订阅通道。since 为该通道上一条已收到的序号。 */
	subscribe: { channel: Channel; since?: number };
	/** 取消订阅。 */
	unsubscribe: { channel: Channel };
	/** 列出模型。 */
	models: { providerId?: string };
	/** 列出当前可用的模型：只来自已配置凭证的提供方，并按凭证收窄过清单。 */
	availableModels: Record<string, never>;
	/** 列出提供方及其凭证状态。 */
	providers: Record<string, never>;
	/** 列出项目里的一个目录。path 为空串表示项目根。 */
	listDirectory: { cwd: string; path: string };
	/**
	 * 读一个文件；文本按 UTF-8 解码，二进制与超大文件只给类型与大小。
	 */
	readFile: { cwd: string; path: string };
	/**
	 * 写回一个文本文件。
	 *
	 * expectedRevision 是读或上次写拿到的摘要；磁盘上的内容已经变过时主机拒绝写入并回
	 * `file_conflict`，由界面决定重新加载还是覆盖。
	 */
	writeFile: { cwd: string; path: string; content: string; expectedRevision: string };
	/** 列出项目工作树相对 HEAD 的改动。 */
	gitStatus: { cwd: string };
	/** 取单个文件的补丁。untracked 为真时按「从空文件新增」合成补丁。 */
	gitDiff: { cwd: string; path: string; untracked?: boolean };
	/** 列出用户添加的项目。 */
	listProjects: Record<string, never>;
	/** 添加项目，目录重复时主机侧拒绝。 */
	addProject: { cwd: string; name?: string };
	/** 重命名项目，名称为空时恢复目录名。 */
	renameProject: { id: string; name?: string };
	/** 移除项目。 */
	removeProject: { id: string };
	/**
	 * 查某个目录的项目级资源需不需要信任。
	 *
	 * hasProjectResources 为假时目录里没有需要信任的资源，直接打开即可；为真而 trusted 缺省
	 * 表示还没做过决定，界面要先问一次。
	 */
	projectTrust: { cwd: string };
	/** 记下某个目录的信任决定。 */
	setProjectTrust: { cwd: string; trusted: boolean };
	/** 在主机的文件管理器里打开某个已添加项目的目录。 */
	revealProject: { id: string };
	/**
	 * 会话改名。
	 *
	 * 已打开的会话直接改运行态；没有打开的会话离线追加一条会话信息条目，不为此启动会话。
	 * 名称为空时去掉自定义名。
	 */
	renameSession: { sessionFile: string; name?: string };
	/** 删除会话文件。不可恢复。 */
	deleteSession: { sessionFile: string };
	/** 读一整份界面偏好设置。 */
	getSettings: Record<string, never>;
	/** 整份替换界面偏好设置，返回主机实际存下的那份。 */
	updateSettings: { settings: FacetSettings };
	/**
	 * 保存提供方凭证。
	 *
	 * 只接受 API key 形式的凭证，密钥写入 pi 的凭证文件，读回来时只给出是否已配置与来源，
	 * 不回传密钥内容。
	 */
	saveCredential: { providerId: string; apiKey: string };
	/** 删除提供方凭证。 */
	deleteCredential: { providerId: string };
	/** 生成一份诊断文本，用于附在问题反馈里。凭证与令牌不在其中。 */
	diagnostics: Record<string, never>;
	/** 用指定模型发一次最小请求，确认凭证、地址与网络是否可用。 */
	testModel: { provider: string; id: string };
	/** 设置提供方的接口地址，空串恢复默认。返回更新后的提供方清单。 */
	setProviderBaseUrl: { providerId: string; baseUrl: string };
	/** 列出用户自己添加的提供方。 */
	listCustomProviders: Record<string, never>;
	/** 新增或修改一个自定义提供方，返回更新后的清单。 */
	saveCustomProvider: { provider: CustomProviderInput };
	/** 删除一个自定义提供方，连同它的凭证，返回更新后的清单。 */
	removeCustomProvider: { providerId: string };
	/** 列出主机上的终端，含已结束的与主机重启前留下的。 */
	listTerminals: Record<string, never>;
	/**
	 * 开一个终端。
	 *
	 * cwd 为空串时用主机用户的 home，界面还没打开会话或项目时也能开；cols 与 rows 由界面的
	 * xterm 实例给出，挂载之后会按 fit 出来的真实尺寸再报一次。
	 */
	createTerminal: { cwd: string; cols: number; rows: number; shell?: string };
	/** 往终端里写入按键。多个端同时写时按到达顺序执行。 */
	writeTerminal: { id: string; data: string };
	/** 改终端尺寸。 */
	resizeTerminal: { id: string; cols: number; rows: number };
	/** 关掉终端，进程收到挂断。 */
	killTerminal: { id: string };
	/**
	 * 确认已收到的输出。
	 *
	 * seq 是端已处理到的通道序号，主机据此扣减未确认字符数，水位降下来再恢复 pty。
	 */
	ackTerminal: { id: string; seq: number };
	/**
	 * 取回滚内容与当前序号。
	 *
	 * 端挂载或断线重连时先取一次，再按 since 订阅增量。
	 */
	serializeTerminal: { id: string };
}

/** 每条请求的应答数据。 */
export interface RequestResults {
	listSessions: { sessions: SessionSummary[] };
	listCommands: { commands: SlashCommand[] };
	busySessions: { files: string[] };
	createSession: SessionSnapshot;
	openSession: SessionSnapshot;
	forkSession: SessionSnapshot;
	snapshot: SessionSnapshot;
	entries: { entries: Entry[]; nextCursor: string | undefined };
	/** 末端为当前叶子,按从早到晚排列 */
	entriesAfter: { entries: Entry[]; leafId: string | null };
	subscribe: SubscribeResult;
	unsubscribe: Record<string, never>;
	models: { models: ModelInfo[] };
	availableModels: { models: ModelInfo[] };
	providers: { providers: ProviderInfo[] };
	listDirectory: { entries: FileEntry[] };
	readFile: FileContent;
	writeFile: FileWriteResult;
	gitStatus: GitStatus;
	gitDiff: GitDiff;
	listProjects: { projects: ProjectInfo[] };
	addProject: ProjectInfo;
	renameProject: ProjectInfo;
	removeProject: Record<string, never>;
	projectTrust: { hasProjectResources: boolean; trusted: boolean | undefined };
	setProjectTrust: Record<string, never>;
	revealProject: Record<string, never>;
	renameSession: Record<string, never>;
	deleteSession: Record<string, never>;
	getSettings: { settings: FacetSettings };
	updateSettings: { settings: FacetSettings };
	saveCredential: { providers: ProviderInfo[] };
	deleteCredential: { providers: ProviderInfo[] };
	diagnostics: { text: string };
	testModel: { ok: boolean; latencyMs: number; message?: string };
	setProviderBaseUrl: { providers: ProviderInfo[] };
	listCustomProviders: { providers: CustomProviderInfo[] };
	saveCustomProvider: { providers: CustomProviderInfo[] };
	removeCustomProvider: { providers: CustomProviderInfo[] };
	listTerminals: { terminals: TerminalInfo[] };
	createTerminal: { terminal: TerminalInfo };
	writeTerminal: Record<string, never>;
	resizeTerminal: Record<string, never>;
	killTerminal: Record<string, never>;
	ackTerminal: Record<string, never>;
	/** text 是回滚缓冲里的可见文本，seq 是当前通道序号，端从 seq 之后接着收增量 */
	serializeTerminal: { text: string; seq: number; cols: number; rows: number };
}

/** 请求方法名。 */
export type RequestMethod = keyof RequestParams;
