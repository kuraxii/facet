/**
 * 开发实例的数据目录布局（`~/.facet-dev`）。
 *
 * `dev-split` 与 `dev-host` 共用这份算法，桌面在开发态按同一规则取值：根目录由 `FACET_DEV_HOME`
 * 或 `~/.facet-dev` 决定，宿主机运行态落在 `host/`、Pi 数据落在 `pi/`、配置落在 `config/`。
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** 开发实例的 Facet 根目录，只认 `FACET_DEV_HOME`。 */
export function devFacetHome(env) {
	const explicit = env.FACET_DEV_HOME?.trim();
	return explicit !== undefined && explicit.length > 0 ? resolve(explicit) : join(homedir(), ".facet-dev");
}

/** 开发实例的宿主机运行态目录（`host/`）。 */
export function devDataDir(env) {
	const explicit = env.FACET_DATA_DIR?.trim();
	if (explicit !== undefined && explicit.length > 0) {
		return explicit;
	}
	return join(devFacetHome(env), "host");
}

/** 开发实例的 pi 数据目录（`pi/`），只认 dev 专用变量。 */
export function devAgentDir(env) {
	return env.FACET_DEV_AGENT_DIR?.trim() || join(devFacetHome(env), "pi");
}

/**
 * 起开发 server 时要给子进程的环境。
 *
 * 把 `FACET_HOME`、`FACET_DATA_DIR`、`FACET_AGENT_DIR` 与 `PI_CODING_AGENT_DIR` 一起钉到
 * 开发目录，避免继承正式终端里的环境变量而写进 `~/.facet`。
 */
export function devServerEnv(env) {
	const facetHome = devFacetHome(env);
	const dataDir = devDataDir(env);
	const agentDir = devAgentDir(env);
	return {
		env: {
			...env,
			FACET_HOME: facetHome,
			FACET_DATA_DIR: dataDir,
			FACET_AGENT_DIR: agentDir,
			PI_CODING_AGENT_DIR: agentDir,
		},
		dataDir,
		agentDir,
	};
}
