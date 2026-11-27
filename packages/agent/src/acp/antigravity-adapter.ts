/**
 * Antigravity ACP 后端适配器实现。
 *
 * 引用通用层定义的 `CanonicalAcpModeId`（5 个标准语义）与 `AcpBackendAdapter` 契约，
 * 在此实现 Antigravity 自身的模式映射与权限决策逻辑。
 */
import type { RequestPermissionRequest } from "@agentclientprotocol/sdk";
import type { AcpBackendAdapter, AcpPermissionDecision, CanonicalAcpModeId } from "./acp-events.ts";
import { extractAntigravityAuthUrl, prepareAntigravityAuthEnv } from "./antigravity-auth.ts";

/** 文件编辑类工具类型（`auto-accept-edits` 模式下自动放行）。 */
const EDIT_TOOL_KINDS = new Set(["edit", "delete", "move"]);

/** 变更类工具类型（`read-only` 模式下禁止执行）。 */
const MUTATING_TOOL_KINDS = new Set(["edit", "delete", "move", "execute"]);

/** Antigravity 线协议模式 id -> 通用 5 档语义。 */
const WIRE_TO_CANONICAL: Readonly<Record<string, CanonicalAcpModeId>> = {
	plan: "read-only",
	default: "supervised",
	"accept-edits": "auto-accept-edits",
	auto: "auto",
};

/** 通用 5 档语义 -> Antigravity 线协议模式 id（由 TS 强制覆盖全部 5 档）。 */
const CANONICAL_TO_WIRE: Readonly<Record<CanonicalAcpModeId, string>> = {
	"read-only": "plan",
	supervised: "default",
	"auto-accept-edits": "accept-edits",
	auto: "auto",
	// Full access 为本地接管放行，下发给 agy 时保持 default
	"full-access": "default",
};

/** 按通用 5 档语义实现 Antigravity 的权限决策。 */
export function decideAntigravityPermission(
	request: RequestPermissionRequest,
	canonicalModeId: CanonicalAcpModeId | undefined,
): AcpPermissionDecision {
	const kind = request.toolCall.kind ?? "other";
	switch (canonicalModeId) {
		case "full-access":
			return "allow";
		case "auto-accept-edits":
			return EDIT_TOOL_KINDS.has(kind) ? "allow" : "ask";
		case "read-only":
			return MUTATING_TOOL_KINDS.has(kind) ? "deny" : "ask";
		case "supervised":
		case "auto":
		case undefined:
			return "ask";
	}
}

/** Antigravity 后端适配器。 */
export const ANTIGRAVITY_ACP_ADAPTER: AcpBackendAdapter = {
	toCanonicalModeId: (wireModeId) => WIRE_TO_CANONICAL[wireModeId] ?? wireModeId,
	toWireModeId: (canonicalModeId) => CANONICAL_TO_WIRE[canonicalModeId],
	decidePermission: decideAntigravityPermission,
	auth: {
		methodId: "oauth-personal",
		prepareEnv: prepareAntigravityAuthEnv,
		extractAuthUrl: extractAntigravityAuthUrl,
	},
};

/** 按后端标识获取可选的 ACP 后端适配器。 */
export function getAcpBackendAdapter(backendId: string): AcpBackendAdapter | undefined {
	return backendId === "antigravity" ? ANTIGRAVITY_ACP_ADAPTER : undefined;
}
