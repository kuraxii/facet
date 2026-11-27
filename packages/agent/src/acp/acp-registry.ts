/**
 * 外部 ACP Agent 注册表与可用性探测。
 *
 * 配置文件采用标准 JSON 存放在宿主数据目录（`<agentDir>/acp-agents.json`），既供
 * Facet 主机拉起会话使用，也供未来的独立跨 Agent 调度插件直接读取而无需引用 @facet/*。
 */
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { type AcpBackendProfile, type BackendAvailability, PI_BACKEND_ID } from "@facet/protocol";
import { writeFileAtomic } from "../atomic-write.ts";

/** 注册表文件格式版本。 */
const REGISTRY_SCHEMA_VERSION = 1;

/** 配置文件名，与 pi 的 models.json 同级放在 agentDir 下。 */
export const ACP_REGISTRY_FILENAME = "acp-agents.json";

/** 环境变量覆盖注册表路径（便于独立插件或测试定位）。 */
export const ACP_REGISTRY_ENV = "FACET_ACP_AGENTS_PATH";

/** 内置 ACP 预设清单（不可彻底删除，仅允许禁用或覆盖参数）。 */
export const BUILTIN_ACP_PROFILES: readonly AcpBackendProfile[] = [
	{
		id: "antigravity",
		name: "Antigravity",
		command: "agy",
		args: ["acp"],
		enabled: true,
		builtIn: true,
		loginHint: "agy acp --login",
	},
];

/** 探测命令存在性所需的最小环境接口，便于单元测试注入。 */
export interface CommandProbeEnv {
	readonly pathEnv?: string;
	readonly pathExt?: string;
	readonly platform?: NodeJS.Platform;
	readonly isExecutable?: (candidate: string) => boolean;
}

/** 自定义探测回调：用于 `probeBackend` 时尝试握手或检错。 */
export type BackendHandshakeProbe = (
	profile: AcpBackendProfile,
	binaryPath: string,
) => Promise<{ ok: boolean; issue?: string }>;

interface StoredRegistry {
	version: number;
	profiles: AcpBackendProfile[];
}

function defaultIsExecutable(candidate: string): boolean {
	if (!existsSync(candidate)) {
		return false;
	}
	try {
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/** 在 PATH 或指定绝对/相对路径中解析可执行文件位置。 */
export function resolveCommandPath(command: string, env: CommandProbeEnv = {}): string | undefined {
	const trimmed = command.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	const check = env.isExecutable ?? defaultIsExecutable;
	const platform = env.platform ?? process.platform;
	if (isAbsolute(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) {
		const resolved = resolve(trimmed);
		return check(resolved) ? resolved : undefined;
	}
	const pathValue = env.pathEnv ?? process.env.PATH ?? "";
	const dirs = pathValue.split(delimiter).filter((item) => item.length > 0);
	const extensions =
		platform === "win32"
			? ["", ...(env.pathExt ?? process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)]
			: [""];
	for (const dir of dirs) {
		for (const ext of extensions) {
			const candidate = join(dir, `${trimmed}${ext}`);
			if (check(candidate)) {
				return candidate;
			}
		}
	}
	return undefined;
}

/** 校验并规范化单条 ACP 后端配置。 */
export function normalizeAcpProfile(
	raw: unknown,
	builtInIds: ReadonlySet<string>,
): AcpBackendProfile | undefined {
	if (typeof raw !== "object" || raw === null) {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	const id = typeof record.id === "string" ? record.id.trim() : "";
	const name = typeof record.name === "string" ? record.name.trim() : "";
	const command = typeof record.command === "string" ? record.command.trim() : "";
	if (id.length === 0 || id === PI_BACKEND_ID || name.length === 0 || command.length === 0) {
		return undefined;
	}
	const args = Array.isArray(record.args)
		? record.args.filter((item): item is string => typeof item === "string")
		: [];
	let env: Record<string, string> | undefined;
	if (typeof record.env === "object" && record.env !== null && !Array.isArray(record.env)) {
		const entries: Array<[string, string]> = [];
		for (const [key, value] of Object.entries(record.env)) {
			if (key.trim().length > 0 && typeof value === "string") {
				entries.push([key.trim(), value]);
			}
		}
		if (entries.length > 0) {
			env = Object.fromEntries(entries);
		}
	}
	const loginHint =
		typeof record.loginHint === "string" && record.loginHint.trim().length > 0
			? record.loginHint.trim()
			: undefined;
	return {
		id,
		name,
		command,
		args,
		...(env === undefined ? {} : { env }),
		enabled: typeof record.enabled === "boolean" ? record.enabled : true,
		...(builtInIds.has(id) || record.builtIn === true ? { builtIn: true } : {}),
		...(loginHint === undefined ? {} : { loginHint }),
	};
}

/** 合并内置预设与磁盘存储配置：内置项始终保留，同 id 用户覆盖优先。 */
export function mergeAcpProfiles(
	stored: readonly AcpBackendProfile[],
	builtIns: readonly AcpBackendProfile[] = BUILTIN_ACP_PROFILES,
): AcpBackendProfile[] {
	const byId = new Map<string, AcpBackendProfile>();
	for (const item of builtIns) {
		byId.set(item.id, { ...item, args: [...item.args], builtIn: true });
	}
	for (const item of stored) {
		const existing = byId.get(item.id);
		if (existing !== undefined) {
			byId.set(item.id, {
				...item,
				args: [...item.args],
				builtIn: true,
				loginHint: item.loginHint ?? existing.loginHint,
			});
		} else {
			byId.set(item.id, { ...item, args: [...item.args] });
		}
	}
	return [...byId.values()];
}

/** 返回单个 ACP 后端的基础可执行性状态（不拉起长连进程）。 */
export function inspectAcpAvailability(
	profile: AcpBackendProfile,
	env: CommandProbeEnv = {},
): BackendAvailability {
	if (!profile.enabled) {
		return {
			id: profile.id,
			kind: "acp",
			name: profile.name,
			available: false,
			enabled: false,
			...(profile.builtIn ? { builtIn: true } : {}),
			...(profile.loginHint === undefined ? {} : { loginHint: profile.loginHint }),
		};
	}
	const binaryPath = resolveCommandPath(profile.command, env);
	if (binaryPath === undefined) {
		return {
			id: profile.id,
			kind: "acp",
			name: profile.name,
			available: false,
			enabled: true,
			...(profile.builtIn ? { builtIn: true } : {}),
			issue: `Executable not found: ${profile.command}`,
			...(profile.loginHint === undefined ? {} : { loginHint: profile.loginHint }),
		};
	}
	return {
		id: profile.id,
		kind: "acp",
		name: profile.name,
		available: true,
		enabled: true,
		...(profile.builtIn ? { builtIn: true } : {}),
		binaryPath,
		...(profile.loginHint === undefined ? {} : { loginHint: profile.loginHint }),
	};
}

/**
 * 外部 ACP 后端配置注册表存储。
 */
export class AcpRegistryStore {
	readonly filePath: string;
	private readonly builtIns: readonly AcpBackendProfile[];
	private readonly probeEnv: CommandProbeEnv;
	/** 缓存上次通过 probeBackend 拿到的深度预检结果 */
	private readonly probeCache = new Map<string, { issue?: string; checkedAt: number }>();

	constructor(options: {
		agentDir: string;
		builtIns?: readonly AcpBackendProfile[];
		probeEnv?: CommandProbeEnv;
	}) {
		const envPath = process.env[ACP_REGISTRY_ENV];
		this.filePath =
			envPath !== undefined && envPath.trim().length > 0
				? resolve(envPath.trim())
				: join(options.agentDir, ACP_REGISTRY_FILENAME);
		this.builtIns = options.builtIns ?? BUILTIN_ACP_PROFILES;
		this.probeEnv = options.probeEnv ?? {};
	}

	/** 列出已合并内置预设的完整配置清单。 */
	listProfiles(): AcpBackendProfile[] {
		const stored = this.readStored();
		return mergeAcpProfiles(stored, this.builtIns);
	}

	/** 按 id 获取单条配置。 */
	getProfile(id: string): AcpBackendProfile | undefined {
		return this.listProfiles().find((item) => item.id === id);
	}

	/** 返回包含 Pi 与全部 ACP 后端的可用性列表。 */
	listAvailability(): BackendAvailability[] {
		const piItem: BackendAvailability = {
			id: PI_BACKEND_ID,
			kind: "pi",
			name: "Pi",
			available: true,
			enabled: true,
			builtIn: true,
		};
		const acpItems = this.listProfiles().map((profile) => {
			const base = inspectAcpAvailability(profile, this.probeEnv);
			const cached = this.probeCache.get(profile.id);
			if (base.available && cached?.issue !== undefined) {
				return { ...base, available: false, issue: cached.issue };
			}
			return base;
		});
		return [piItem, ...acpItems];
	}

	/** 保存或更新一条 ACP 配置，写入后清理对应预检缓存。 */
	async saveProfile(input: AcpBackendProfile): Promise<AcpBackendProfile[]> {
		const builtInIds = new Set(this.builtIns.map((item) => item.id));
		const normalized = normalizeAcpProfile(input, builtInIds);
		if (normalized === undefined) {
			throw new Error(`Invalid ACP backend profile: ${input.id}`);
		}
		const current = this.readStored();
		const next = [...current.filter((item) => item.id !== normalized.id), normalized];
		await this.writeStored(next);
		this.probeCache.delete(normalized.id);
		return this.listProfiles();
	}

	/** 删除一条自定义 ACP 配置（内置预设拒绝删除）。 */
	async removeProfile(backendId: string): Promise<AcpBackendProfile[]> {
		if (backendId === PI_BACKEND_ID || this.builtIns.some((item) => item.id === backendId)) {
			throw new Error(`Built-in backend cannot be removed: ${backendId}`);
		}
		const current = this.readStored();
		const next = current.filter((item) => item.id !== backendId);
		await this.writeStored(next);
		this.probeCache.delete(backendId);
		return this.listProfiles();
	}

	/** 对指定后端执行可达性与可选的握手探测，并记下失败原因。 */
	async probe(backendId: string, handshakeProbe?: BackendHandshakeProbe): Promise<BackendAvailability> {
		if (backendId === PI_BACKEND_ID) {
			return {
				id: PI_BACKEND_ID,
				kind: "pi",
				name: "Pi",
				available: true,
				enabled: true,
				builtIn: true,
			};
		}
		const profile = this.getProfile(backendId);
		if (profile === undefined) {
			throw new Error(`Unknown backend: ${backendId}`);
		}
		const base = inspectAcpAvailability(profile, this.probeEnv);
		if (!base.available || base.binaryPath === undefined || handshakeProbe === undefined) {
			this.probeCache.delete(backendId);
			return base;
		}
		const check = await handshakeProbe(profile, base.binaryPath);
		if (check.ok) {
			this.probeCache.delete(backendId);
			return base;
		}
		const issue = check.issue ?? "Backend initialization probe failed";
		this.probeCache.set(backendId, { issue, checkedAt: Date.now() });
		return { ...base, available: false, issue };
	}

	private readStored(): AcpBackendProfile[] {
		if (!existsSync(this.filePath)) {
			return [];
		}
		try {
			const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StoredRegistry>;
			const list = Array.isArray(parsed.profiles) ? parsed.profiles : [];
			const builtInIds = new Set(this.builtIns.map((item) => item.id));
			return list
				.map((item) => normalizeAcpProfile(item, builtInIds))
				.filter((item): item is AcpBackendProfile => item !== undefined);
		} catch {
			return [];
		}
	}

	private async writeStored(profiles: AcpBackendProfile[]): Promise<void> {
		const payload: StoredRegistry = { version: REGISTRY_SCHEMA_VERSION, profiles };
		await writeFileAtomic(this.filePath, `${JSON.stringify(payload, null, "\t")}\n`);
	}
}
