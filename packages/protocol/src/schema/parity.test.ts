/**
 * 参数类型的等价性断言。
 *
 * `RequestParams` 现在由 `schema/contracts.ts` 的 Schema 推导。这里冻结重构前手写的那份
 * 声明（一字未改），逐个方法断言两者的类型完全相同；任何一个方法漂了，这里编译不过。
 */
import { describe, expect, it } from "vitest";
import type { Channel } from "../channel.ts";
import type { UiResponse } from "../extension-ui.ts";
import type { CustomProviderInput, ModelRef, ThinkingLevel } from "../model.ts";
import type { FacetSettings } from "../settings.ts";
import type { RequestParams } from "../wire.ts";

/** 两个类型完全一致时为 true，比 `extends` 更严格：可选性与成员顺序都参与比较。 */
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** 编译期断言；运行期只返回 true。 */
function assertEqual<A, B>(_proof: Equals<A, B> extends true ? true : never): true {
	return true;
}

/** 重构前的参数声明，逐字保留。 */
interface FrozenRequestParams {
	respondUi: { sessionId: string; requestId: string; response: UiResponse };
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
	/** 列出当前分支的全部提交。 */
	gitCommits: { cwd: string };
	/** 取一次提交相对第一父提交的改动清单。 */
	gitCommit: { cwd: string; sha: string };
	/** 取一次提交里某个文件的补丁。 */
	gitCommitDiff: { cwd: string; sha: string; path: string; oldPath?: string };
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
	/** 在主机的文件管理器里打开任意目录，路径由调用方给出。 */
	revealPath: { path: string };
	/**
	 * 会话改名。
	 *
	 * 已打开的会话直接改运行态；没有打开的会话离线追加一条会话信息条目，不为此启动会话。
	 * 名称为空时去掉自定义名。
	 */
	renameSession: { sessionFile: string; name?: string };
	/** 删除会话文件。不可恢复。 */
	deleteSession: { sessionFile: string };
	/**
	 * 把这些会话标记为已读。
	 *
	 * 只记水位，不读会话文件；主机收到后广播新的状态，多端看到同一份未读结果。
	 */
	markSessionsSeen: { sessionFiles: string[] };
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

describe("参数类型与重构前一致", () => {
	it("每个方法的参数类型都没有漂移", () => {
		const proofs: { [K in keyof FrozenRequestParams]: true } = {
			respondUi: assertEqual<RequestParams["respondUi"], FrozenRequestParams["respondUi"]>(true),
			listSessions: assertEqual<RequestParams["listSessions"], FrozenRequestParams["listSessions"]>(true),
			listCommands: assertEqual<RequestParams["listCommands"], FrozenRequestParams["listCommands"]>(true),
			busySessions: assertEqual<RequestParams["busySessions"], FrozenRequestParams["busySessions"]>(true),
			createSession: assertEqual<RequestParams["createSession"], FrozenRequestParams["createSession"]>(true),
			openSession: assertEqual<RequestParams["openSession"], FrozenRequestParams["openSession"]>(true),
			forkSession: assertEqual<RequestParams["forkSession"], FrozenRequestParams["forkSession"]>(true),
			snapshot: assertEqual<RequestParams["snapshot"], FrozenRequestParams["snapshot"]>(true),
			entries: assertEqual<RequestParams["entries"], FrozenRequestParams["entries"]>(true),
			entriesAfter: assertEqual<RequestParams["entriesAfter"], FrozenRequestParams["entriesAfter"]>(true),
			subscribe: assertEqual<RequestParams["subscribe"], FrozenRequestParams["subscribe"]>(true),
			unsubscribe: assertEqual<RequestParams["unsubscribe"], FrozenRequestParams["unsubscribe"]>(true),
			models: assertEqual<RequestParams["models"], FrozenRequestParams["models"]>(true),
			availableModels: assertEqual<RequestParams["availableModels"], FrozenRequestParams["availableModels"]>(
				true,
			),
			providers: assertEqual<RequestParams["providers"], FrozenRequestParams["providers"]>(true),
			listDirectory: assertEqual<RequestParams["listDirectory"], FrozenRequestParams["listDirectory"]>(true),
			readFile: assertEqual<RequestParams["readFile"], FrozenRequestParams["readFile"]>(true),
			writeFile: assertEqual<RequestParams["writeFile"], FrozenRequestParams["writeFile"]>(true),
			gitStatus: assertEqual<RequestParams["gitStatus"], FrozenRequestParams["gitStatus"]>(true),
			gitDiff: assertEqual<RequestParams["gitDiff"], FrozenRequestParams["gitDiff"]>(true),
			gitCommits: assertEqual<RequestParams["gitCommits"], FrozenRequestParams["gitCommits"]>(true),
			gitCommit: assertEqual<RequestParams["gitCommit"], FrozenRequestParams["gitCommit"]>(true),
			gitCommitDiff: assertEqual<RequestParams["gitCommitDiff"], FrozenRequestParams["gitCommitDiff"]>(true),
			listProjects: assertEqual<RequestParams["listProjects"], FrozenRequestParams["listProjects"]>(true),
			addProject: assertEqual<RequestParams["addProject"], FrozenRequestParams["addProject"]>(true),
			renameProject: assertEqual<RequestParams["renameProject"], FrozenRequestParams["renameProject"]>(true),
			removeProject: assertEqual<RequestParams["removeProject"], FrozenRequestParams["removeProject"]>(true),
			projectTrust: assertEqual<RequestParams["projectTrust"], FrozenRequestParams["projectTrust"]>(true),
			setProjectTrust: assertEqual<RequestParams["setProjectTrust"], FrozenRequestParams["setProjectTrust"]>(
				true,
			),
			revealProject: assertEqual<RequestParams["revealProject"], FrozenRequestParams["revealProject"]>(true),
			revealPath: assertEqual<RequestParams["revealPath"], FrozenRequestParams["revealPath"]>(true),
			renameSession: assertEqual<RequestParams["renameSession"], FrozenRequestParams["renameSession"]>(true),
			deleteSession: assertEqual<RequestParams["deleteSession"], FrozenRequestParams["deleteSession"]>(true),
			markSessionsSeen: assertEqual<
				RequestParams["markSessionsSeen"],
				FrozenRequestParams["markSessionsSeen"]
			>(true),
			getSettings: assertEqual<RequestParams["getSettings"], FrozenRequestParams["getSettings"]>(true),
			updateSettings: assertEqual<RequestParams["updateSettings"], FrozenRequestParams["updateSettings"]>(
				true,
			),
			saveCredential: assertEqual<RequestParams["saveCredential"], FrozenRequestParams["saveCredential"]>(
				true,
			),
			deleteCredential: assertEqual<
				RequestParams["deleteCredential"],
				FrozenRequestParams["deleteCredential"]
			>(true),
			diagnostics: assertEqual<RequestParams["diagnostics"], FrozenRequestParams["diagnostics"]>(true),
			testModel: assertEqual<RequestParams["testModel"], FrozenRequestParams["testModel"]>(true),
			listCustomProviders: assertEqual<
				RequestParams["listCustomProviders"],
				FrozenRequestParams["listCustomProviders"]
			>(true),
			saveCustomProvider: assertEqual<
				RequestParams["saveCustomProvider"],
				FrozenRequestParams["saveCustomProvider"]
			>(true),
			removeCustomProvider: assertEqual<
				RequestParams["removeCustomProvider"],
				FrozenRequestParams["removeCustomProvider"]
			>(true),
			listTerminals: assertEqual<RequestParams["listTerminals"], FrozenRequestParams["listTerminals"]>(true),
			createTerminal: assertEqual<RequestParams["createTerminal"], FrozenRequestParams["createTerminal"]>(
				true,
			),
			writeTerminal: assertEqual<RequestParams["writeTerminal"], FrozenRequestParams["writeTerminal"]>(true),
			resizeTerminal: assertEqual<RequestParams["resizeTerminal"], FrozenRequestParams["resizeTerminal"]>(
				true,
			),
			killTerminal: assertEqual<RequestParams["killTerminal"], FrozenRequestParams["killTerminal"]>(true),
			ackTerminal: assertEqual<RequestParams["ackTerminal"], FrozenRequestParams["ackTerminal"]>(true),
			serializeTerminal: assertEqual<
				RequestParams["serializeTerminal"],
				FrozenRequestParams["serializeTerminal"]
			>(true),
		};
		expect(Object.values(proofs).every((value) => value === true)).toBe(true);
		expect(Object.keys(proofs)).toHaveLength(51);
	});
});
