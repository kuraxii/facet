import {
	type ExtensionAPI,
	type ExtensionContext,
	type SessionEntry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { loadConfig } from "./config.ts";
import { type AnyModel, contentToText, generateNames, type NameFlowContext, resolveModel } from "./naming.ts";

/**
 * Register automatic naming on the first completed reply.
 *
 * The runner calls `agent_end` for every turn. The handler returns immediately and
 * the naming request runs outside the agent loop, so a slow model or a model picker
 * never blocks the conversation.
 */
export function registerAutoName(pi: ExtensionAPI): void {
	pi.on("agent_end", (_event, ctx) => {
		void autoNameCurrent(pi, ctx);
	});
}

/** Export for tests; the real call is wrapped so naming failures never reach the agent loop. */
export async function autoNameCurrent(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
	try {
		const config = loadConfig();
		if (!config.autoNameNewSessions) return;

		const header = ctx.sessionManager.getHeader();
		const parentPath = header?.parentSession;
		const entries = ctx.sessionManager.getEntries();
		const parentIds = parentPath === undefined ? undefined : await parentEntryIds(ctx, parentPath);

		if (hasOwnName(ctx, entries, parentIds)) return;

		const source = findNameSource(entries, parentIds);
		if (source === null) return;

		let model: AnyModel;
		try {
			model = await resolveModel(ctx as NameFlowContext, config);
		} catch {
			// No usable model and no UI to ask with; stay silent in the background.
			return;
		}

		const [name] = await generateNames(ctx.modelRegistry, model, [source], config, ctx.signal);
		if (!name) return;

		// The user may have named the session while the model was generating.
		if (hasOwnName(ctx, ctx.sessionManager.getEntries(), parentIds)) return;
		pi.setSessionName(name);
	} catch {
		// Never let auto-naming break the agent loop.
	}
}

async function parentEntryIds(ctx: ExtensionContext, parentPath: string): Promise<ReadonlySet<string>> {
	const parent = await SessionManager.open(parentPath, ctx.sessionManager.getSessionDir());
	return new Set(parent.getEntries().map((entry) => entry.id));
}

/**
 * Whether the session already has a name written on this branch.
 *
 * A fork inherits the parent's session_info entries. Those inherited entries do not
 * count as the child's own name; only a post-fork session_info does.
 */
export function hasOwnName(
	ctx: ExtensionContext,
	entries: readonly SessionEntry[],
	parentIds: ReadonlySet<string> | undefined,
): boolean {
	if (parentIds === undefined) {
		return Boolean(ctx.sessionManager.getSessionName()?.trim());
	}
	return entries.some(
		(entry) => entry.type === "session_info" && !parentIds.has(entry.id) && Boolean(sessionInfoName(entry)),
	);
}

/**
 * First user message belonging to this branch.
 *
 * For a fork, messages copied from the parent keep their entry ids. Skipping those
 * makes the name describe the fork's own topic instead of repeating the parent name.
 */
export function findNameSource(
	entries: readonly SessionEntry[],
	parentIds: ReadonlySet<string> | undefined,
): string | null {
	for (const entry of entries) {
		if (entry.type !== "message") continue;
		if (parentIds?.has(entry.id) === true) continue;
		const message = (entry as Extract<SessionEntry, { type: "message" }>).message;
		if (message?.role !== "user") continue;
		const text = contentToText(message.content);
		if (text.length > 0) return text;
	}
	return null;
}

function sessionInfoName(entry: SessionEntry): string | undefined {
	if (entry.type !== "session_info") return undefined;
	return (entry as { name?: string }).name?.trim() || undefined;
}
