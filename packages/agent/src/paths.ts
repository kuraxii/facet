/**
 * facet 的统一数据目录布局（`~/.facet` 与开发态 `~/.facet-dev`）。
 *
 * 所有宿主机运行态（`host/`）、配置（`config/`）、Pi 后端（`pi/`）、ACP 索引与探针（`acp/`）
 * 以及无项目会话的临时工作区（`scratch/`）都收拢在同一个根目录下，可通过 `FACET_HOME`
 * 覆盖；各子目录也保留独立环境变量覆盖，便于测试与多实例隔离。
 *
 * pi 的缺省路径由 `PI_CODING_AGENT_DIR` 推出，设置一次即整体搬迁到 `<FACET_HOME>/pi`；
 * 该变量会被子进程继承，因此开发态必须固定钉到 `~/.facet-dev/pi`，避免误读写正式目录。
 */
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** pi 读取 agent 目录的环境变量名 */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** 发布版根目录 */
export const DEFAULT_FACET_HOME = resolve(homedir(), ".facet");

/** 开发期根目录，与发布版隔离 */
export const DEV_FACET_HOME = resolve(homedir(), ".facet-dev");

/** 发布版 Pi 数据目录 */
export const DEFAULT_AGENT_DIR = join(DEFAULT_FACET_HOME, "pi");

/** 开发期 Pi 数据目录，与发布版分开 */
export const DEV_AGENT_DIR = join(DEV_FACET_HOME, "pi");

/** 展开路径开头的波浪号，相对路径按进程工作目录解析成绝对路径。 */
export function expandPath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return resolve(homedir(), path.slice(2));
	}
	return resolve(path);
}

/** 解析 Facet 根目录：开发态只认 `FACET_DEV_HOME`，避免从正式壳继承 `FACET_HOME`。 */
export function resolveFacetHome(
	env: Record<string, string | undefined> = process.env,
	isDev = false,
): string {
	if (isDev) {
		const devHome = env.FACET_DEV_HOME?.trim();
		return devHome !== undefined && devHome.length > 0 ? expandPath(devHome) : DEV_FACET_HOME;
	}
	const explicit = env.FACET_HOME?.trim();
	return explicit !== undefined && explicit.length > 0 ? expandPath(explicit) : DEFAULT_FACET_HOME;
}

/**
 * 把 pi 的缺省数据目录指向 facet 的 `pi/` 目录。
 *
 * 优先级：已设置的环境变量、调用方给出的目录、`<DEFAULT_FACET_HOME>/pi`。写入后立即
 * 回读校验，pi 若改了变量名会直接报错，而不是安静地用回 `~/.pi/agent`。
 */
export function applyAgentDir(agentDir?: string): string {
	const preset = process.env[AGENT_DIR_ENV];
	const source = preset !== undefined && preset.trim().length > 0 ? preset : (agentDir ?? DEFAULT_AGENT_DIR);
	const target = expandPath(source);
	process.env[AGENT_DIR_ENV] = target;
	const applied = resolve(getAgentDir());
	if (applied !== target) {
		throw new Error(`pi did not apply the agent directory setting; expected ${target}, got ${applied}`);
	}
	return target;
}
