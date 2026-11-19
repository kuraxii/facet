/**
 * 开发实例的两个目录。
 *
 * `dev-split` 与 `dev-host` 共用这份算法，桌面在开发态按同一规则取值：数据目录决定 socket
 * 与 projects.json，pi 数据目录决定会话、凭证与模型配置，两边算法不一致就接不上对方写下的
 * 东西。
 *
 * 两个目录都带 `dev` 后缀，与发布实例分开。pi 数据目录只认 `FACET_DEV_AGENT_DIR`：从
 * facet 自带的终端、或从 pi 拉起的 shell 里启动时，环境里已经有 `FACET_AGENT_DIR` 与
 * `PI_CODING_AGENT_DIR` 指向真实目录（facet 的 server 会把自己的 agent 目录写回环境传给子
 * 进程，见 `packages/agent/src/paths.ts`），照抄下去开发期的会话与凭证就写进了真实数据。
 */

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * 开发实例的 facet 数据目录。
 *
 * 显式给了 `FACET_DATA_DIR` 就用它——那是调用方明确指定的位置，不从这里推断。
 */
export function devDataDir(env) {
	const explicit = env.FACET_DATA_DIR?.trim();
	if (explicit !== undefined && explicit.length > 0) {
		return explicit;
	}
	const xdg = env.XDG_DATA_HOME?.trim();
	const base = xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), ".local", "share");
	return join(base, "facet-dev");
}

/** 开发实例的 pi 数据目录，只认 dev 专用变量。 */
export function devAgentDir(env) {
	return env.FACET_DEV_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent-dev");
}

/**
 * 起开发 server 时要给子进程的环境。
 *
 * 把两个 agent 目录变量一起显式写成 dev 目录：`PI_CODING_AGENT_DIR` 在 pi 里优先级最高，
 * 只覆盖 `FACET_AGENT_DIR` 挡不住继承来的值。
 */
export function devServerEnv(env) {
	const dataDir = devDataDir(env);
	const agentDir = devAgentDir(env);
	return {
		env: {
			...env,
			FACET_DATA_DIR: dataDir,
			FACET_AGENT_DIR: agentDir,
			PI_CODING_AGENT_DIR: agentDir,
		},
		dataDir,
		agentDir,
	};
}
