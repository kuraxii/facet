/**
 * 多后端代理（Pi 与外部 ACP Agent）的共享契约、能力标记与定位符工具。
 *
 * 这里只包含纯数据类型、静态能力预设与纯字符串定位符解析函数，零运行时依赖，
 * 供协议层、Agent 运行时、服务端、客户端状态与 UI 共同引用。
 */

/** 代理后端种类。 */
export type AgentKind = "pi" | "acp";

/** 原生 Pi 代理固定标识。 */
export const PI_AGENT_ID = "pi";

/** 外部 ACP 会话定位符前缀，用于与本地 .jsonl 文件路径区分。 */
export const ACP_LOCATOR_PREFIX = "acp://";

/** 构建 ACP 会话定位符：`acp://<agentId>/<externalSessionId>`。 */
export function makeAcpLocator(agentId: string, externalSessionId: string): string {
	return `${ACP_LOCATOR_PREFIX}${encodeURIComponent(agentId)}/${encodeURIComponent(externalSessionId)}`;
}

/** 解析 ACP 会话定位符；若格式不符返回 undefined。 */
export function parseAcpLocator(locator: string): { agentId: string; externalSessionId: string } | undefined {
	if (!locator.startsWith(ACP_LOCATOR_PREFIX)) {
		return undefined;
	}
	const rest = locator.slice(ACP_LOCATOR_PREFIX.length);
	const slash = rest.indexOf("/");
	if (slash <= 0 || slash === rest.length - 1) {
		return undefined;
	}
	try {
		const agentId = decodeURIComponent(rest.slice(0, slash));
		const externalSessionId = decodeURIComponent(rest.slice(slash + 1));
		if (agentId.length === 0 || externalSessionId.length === 0) {
			return undefined;
		}
		return { agentId, externalSessionId };
	} catch {
		return undefined;
	}
}

/** 判断一个会话定位符是否指向 ACP 会话。 */
export function isAcpLocator(locator: string): boolean {
	return parseAcpLocator(locator) !== undefined;
}

/**
 * 单个会话支持的功能能力标记，界面据此隐藏不支持的交互入口。
 */
export interface AgentCapabilities {
	/** 支持从历史条目分叉出新会话（forkSession） */
	canFork: boolean;
	/** 支持回退分支到某条用户消息之前（chat/revertTo） */
	canRevert: boolean;
	/** 支持手动压缩上下文（session/compact） */
	canCompact: boolean;
	/** 支持查看上下文窗口分项拆解（contextDetails） */
	hasContextBreakdown: boolean;
	/** 支持查看当前声明给模型的工具清单 */
	hasToolsList: boolean;
	/** 运行中支持插话与退回（streamingBehavior: "steer" / session/steeringDemoted） */
	supportsSteering: boolean;
	/** 运行中支持后续排队卡片（followUp） */
	supportsFollowUp: boolean;
	/** 输入区配置芯片形态：pi 模型/思考档位 vs ACP 动态模式与配置项 */
	configStyle: "pi" | "acp";
	/** 支持通过后端历史加载能力恢复旧消息（如 ACP loadSession） */
	supportsHistoryLoad: boolean;
	/** 支持随消息附带图片 */
	supportsImages: boolean;
}

/** 原生 Pi 后端的完整能力集合。 */
export const PI_AGENT_CAPABILITIES: AgentCapabilities = {
	canFork: true,
	canRevert: true,
	canCompact: true,
	hasContextBreakdown: true,
	hasToolsList: true,
	supportsSteering: true,
	supportsFollowUp: true,
	configStyle: "pi",
	supportsHistoryLoad: true,
	supportsImages: true,
};

/** 外部 ACP 后端的基础默认能力（具体会结合 initialize 协商结果补强）。 */
export const DEFAULT_ACP_CAPABILITIES: AgentCapabilities = {
	canFork: false,
	canRevert: false,
	canCompact: false,
	hasContextBreakdown: false,
	hasToolsList: false,
	supportsSteering: false,
	supportsFollowUp: false,
	configStyle: "acp",
	supportsHistoryLoad: false,
	supportsImages: false,
};

/** ACP 会话模式项（如 default / accept-edits / plan）。 */
export interface AcpModeOption {
	/** 模式标识 */
	id: string;
	/** 展示名称 */
	name: string;
	/** 模式说明 */
	description?: string;
}

/** ACP 会话当前模式状态。 */
export interface AcpModeState {
	/** 当前激活的模式标识 */
	currentModeId: string;
	/** 后端支持的可切换模式列表 */
	availableModes: AcpModeOption[];
}

/** ACP 动态配置选项的一个候选值。 */
export interface AcpConfigOptionChoice {
	/** 提交给 session/set_config_option 的原始值 */
	value: string;
	/** 展示名称 */
	name: string;
	/** 补充说明 */
	description?: string;
	/** 所属分组名（可选） */
	group?: string;
}

/** ACP 动态配置项（对应稳定协议 session/set_config_option）。 */
export interface AcpConfigOption {
	/** 配置项唯一标识 */
	id: string;
	/** 配置项展示名称 */
	name: string;
	/** 配置项描述 */
	description?: string;
	/** 语义类别（如 "model"、"mode"、"thought_level"） */
	category?: string;
	/** 当前选中值 */
	currentValue: string;
	/** 全部可选项 */
	options: AcpConfigOptionChoice[];
}

/** 一份外部 ACP Agent 的注册配置（主机与独立插件共用这一结构）。 */
export interface AcpAgentProfile {
	/** 代理稳定标识（如 "antigravity" 或自定义 slug） */
	id: string;
	/** 展示名称 */
	name: string;
	/** 可执行命令名或绝对路径（如 "agy"） */
	command: string;
	/** 启动参数（如 ["acp"]） */
	args: string[];
	/** 附加环境变量 */
	env?: Record<string, string>;
	/** 是否启用 */
	enabled: boolean;
	/** 是否为内置预设（内置预设不可彻底删除，只能禁用或改参数） */
	builtIn?: boolean;
	/** 未安装或未登录时给用户的终端指引（如 "agy acp --login"） */
	loginHint?: string;
}

/** 主机上报的单个代理可用性摘要，用于侧栏切换器与设置页展示。 */
export interface AgentAvailability {
	/** 代理标识（Pi 为 "pi"，ACP 为配置里的 id） */
	id: string;
	/** 代理种类 */
	kind: AgentKind;
	/** 展示名称 */
	name: string;
	/** 命令是否已探测到且启用 */
	available: boolean;
	/** 是否处于启用状态 */
	enabled: boolean;
	/** 是否为内置项 */
	builtIn?: boolean;
	/** 解析到的可执行路径 */
	binaryPath?: string;
	/** 探测或预检失败的事实原因 */
	issue?: string;
	/** 终端登录或安装命令指引 */
	loginHint?: string;
}
