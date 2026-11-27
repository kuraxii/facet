/**
 * 多后端侧栏过滤、能力门控与 ACP 动态配置纯逻辑。
 *
 * 所有计算与转换都留在不依赖 React / DOM 的纯函数层，供侧栏、输入区与设置页共用。
 */
import {
	type AcpConfigOptionChoice,
	type AgentCapabilities,
	type BackendAvailability,
	PI_AGENT_CAPABILITIES,
	PI_BACKEND_ID,
	type SessionSummary,
} from "@facet/protocol";

/** 读取一条会话所属后端标识；未声明时按 Pi 处理。 */
export function backendIdOf(summary: Pick<SessionSummary, "backendId">): string {
	return summary.backendId ?? PI_BACKEND_ID;
}

/** 按当前选中的代理后端过滤侧栏会话列表，保证各后端列表互相隔离。 */
export function filterSessionsByBackend(
	sessions: readonly SessionSummary[],
	selectedBackendId: string,
): SessionSummary[] {
	return sessions.filter((summary) => backendIdOf(summary) === selectedBackendId);
}

/** 当持久化选中的后端已不存在或不可见时，安全回退到 Pi。 */
export function resolveBackendSelection(
	backends: readonly BackendAvailability[],
	preferredId: string | undefined,
): string {
	if (preferredId !== undefined && backends.some((backend) => backend.id === preferredId)) {
		return preferredId;
	}
	return PI_BACKEND_ID;
}

/** 补全会话能力标记，缺省按原生 Pi 完整能力处理。 */
export function capabilitiesOf(capabilities: AgentCapabilities | undefined): AgentCapabilities {
	return capabilities ?? PI_AGENT_CAPABILITIES;
}

/** 将空格分隔的参数字符串解析为参数数组。 */
export function parseCommandArgs(raw: string): string[] {
	return raw
		.split(/\s+/)
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
}

/** 按可选 group 字段将 ACP 配置候选值分组，保持原序。 */
export function groupConfigChoices(
	choices: readonly AcpConfigOptionChoice[],
): Array<[string | undefined, AcpConfigOptionChoice[]]> {
	const groups = new Map<string | undefined, AcpConfigOptionChoice[]>();
	for (const choice of choices) {
		const key = choice.group;
		const bucket = groups.get(key);
		if (bucket === undefined) {
			groups.set(key, [choice]);
		} else {
			bucket.push(choice);
		}
	}
	return [...groups.entries()];
}
