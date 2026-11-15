import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** How automatic naming behaves for new sessions. */
export interface SessionNamesConfig {
	/** "provider/modelId" used to generate names; null means not configured yet. */
	model: string | null;
	/** Generate a name after the first assistant reply. */
	autoNameNewSessions: boolean;
	/** System prompt for the summarizer. */
	summaryPrompt: string;
	/** Hard cap on name length after normalization. */
	maxNameLength: number;
}

export const DEFAULT_SUMMARY_PROMPT =
	"Generate a concise, natural one-sentence session name in the same language as the first user message. Summarize the user's core intent. Return only the name, without quotes, punctuation, or explanation.";

const DEFAULT_CONFIG: SessionNamesConfig = {
	model: null,
	autoNameNewSessions: true,
	summaryPrompt: DEFAULT_SUMMARY_PROMPT,
	maxNameLength: 30,
};

function configPath(): string {
	return join(getAgentDir(), "session-names.json");
}

/** Read the config, accepting the old `"overwrite"` value as enabled. */
export function loadConfig(path = configPath()): SessionNamesConfig {
	if (!existsSync(path)) {
		try {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`, "utf8");
		} catch {
			// A read-only agent directory must not disable the plugin.
		}
		return { ...DEFAULT_CONFIG };
	}

	try {
		const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
		return {
			model: typeof raw.model === "string" && raw.model.trim() ? raw.model.trim() : null,
			autoNameNewSessions: raw.autoNameNewSessions === "overwrite" || raw.autoNameNewSessions === true,
			summaryPrompt:
				typeof raw.summaryPrompt === "string" && raw.summaryPrompt.trim()
					? raw.summaryPrompt
					: DEFAULT_CONFIG.summaryPrompt,
			maxNameLength:
				typeof raw.maxNameLength === "number" && Number.isFinite(raw.maxNameLength) && raw.maxNameLength > 0
					? Math.min(Math.floor(raw.maxNameLength), 100)
					: DEFAULT_CONFIG.maxNameLength,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function saveConfig(patch: Partial<SessionNamesConfig>, path = configPath()): SessionNamesConfig {
	const next = { ...loadConfig(path), ...patch };
	try {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
	} catch {
		// Best-effort persist; the in-memory result is still returned.
	}
	return next;
}

/** Parse "provider/modelId" (split on the first slash). */
export function parseModelSpec(model: string | null): { provider: string; modelId: string } | null {
	if (!model) return null;
	const idx = model.indexOf("/");
	if (idx <= 0 || idx === model.length - 1) return null;
	return { provider: model.slice(0, idx), modelId: model.slice(idx + 1) };
}

/** Format a model as "provider/modelId". */
export function formatModelSpec(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}
