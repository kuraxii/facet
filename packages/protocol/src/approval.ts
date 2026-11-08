/**
 * 工具审批的请求与应答。
 *
 * 只描述跨边界的数据，判定规则由设备侧的权限模块决定。
 */

/** 一次待应答的工具审批请求。 */
export interface ApprovalRequest {
	/** 请求 id，与工具调用 id 区分，同一次调用被重新请求时也不复用 */
	id: string;
	/** 对应的工具调用 id */
	callId: string;
	/** 申请执行的工具名 */
	toolName: string;
	/** 调用参数，供审批界面展示影响范围 */
	input: unknown;
	/** 会话所在工作目录 */
	cwd: string;
	/** 由其他工具发起的嵌套调用时，指向外层调用 id */
	parentCallId?: string;
}

/** 审批结果。除 allow 之外的取值一律按拒绝处理。 */
export interface ApprovalDecision {
	action: "allow" | "deny";
	/** 拒绝原因，会作为工具结果返回给模型 */
	reason?: string;
}
