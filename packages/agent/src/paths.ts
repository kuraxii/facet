/**
 * facet 的数据目录。
 *
 * pi 的缺省目录 ~/.pi/agent 与命令行工具共用,开发期写入会混进真实的凭证、模型配置
 * 与会话文件。facet 缺省改用 ~/.pi/agent-dev。pi 的全部缺省路径(凭证、模型目录、
 * 会话、设置、工具、提示词)都由同一个环境变量推出,设置一次即整体搬迁。
 */
import { homedir } from "node:os";
import { resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** pi 读取 agent 目录的环境变量名 */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** facet 的开发期数据目录 */
export const DEFAULT_AGENT_DIR = resolve(homedir(), ".pi", "agent-dev");

/** 展开路径开头的波浪号,相对路径按进程工作目录解析成绝对路径。 */
function expandPath(path: string): string {
	if (path === "~") {
		return homedir();
	}
	if (path.startsWith("~/")) {
		return resolve(homedir(), path.slice(2));
	}
	return resolve(path);
}

/**
 * 把 pi 的缺省数据目录指向 facet 的目录。
 *
 * 优先级:已设置的环境变量、调用方给出的目录、facet 开发目录。环境变量优先是为了
 * 让测试与并行的多个实例能各自隔离。写入后立即回读校验,pi 若改了变量名会直接报错,
 * 而不是安静地用回 ~/.pi/agent。
 *
 * 返回实际生效的目录,调用方用它拼凭证与模型配置的路径。
 */
export function applyAgentDir(agentDir?: string): string {
	const preset = process.env[AGENT_DIR_ENV];
	const source = preset !== undefined && preset.trim().length > 0 ? preset : (agentDir ?? DEFAULT_AGENT_DIR);
	const target = expandPath(source);
	process.env[AGENT_DIR_ENV] = target;
	const applied = resolve(getAgentDir());
	if (applied !== target) {
		throw new Error(`pi 没有采纳 agent 目录设置,期望 ${target},实际 ${applied}`);
	}
	return target;
}
