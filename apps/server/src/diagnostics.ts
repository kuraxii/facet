/**
 * 诊断导出。
 *
 * 生成一份可以直接贴进问题的文本：版本、平台、数据目录、模型与提供方状态、项目与会话计数
 * 都在里面；凭证、令牌与密钥一律不写，因为唯一带密钥的文件是 auth.json，这里只报它有没有
 * 配置，不读内容。
 */
import { stat } from "node:fs/promises";
import { arch, platform, release } from "node:os";
import type { FacetSettings } from "@facet/protocol";

/** 生成诊断文本需要的输入。 */
export interface DiagnosticsInput {
	/** 协议版本 */
	protocolVersion: number;
	/** 主机标识与展示名 */
	hostId: string;
	hostName: string;
	/** 实际生效的数据目录 */
	agentDir: string;
	/** 应用数据目录 */
	dataDir: string;
	/** 会话文件目录，缺省时按工作目录分组 */
	sessionDir: string | undefined;
	/** 会话数 */
	sessionCount: number;
	/** 项目清单 */
	projects: readonly { cwd: string; name: string | undefined }[];
	/** 提供方与其凭证状态 */
	providers: readonly { id: string; authenticated: boolean; modelCount: number; authSource?: string }[];
	/** 界面偏好设置 */
	settings: FacetSettings;
	/** 当前时间，Unix 毫秒 */
	now: number;
}

/** 数据目录里单个文件的大小，读不到时为空。 */
async function fileSize(file: string): Promise<number | undefined> {
	try {
		return (await stat(file)).size;
	} catch {
		return undefined;
	}
}

/** 生成诊断文本。内容是 JSON，字段按问题排查的顺序排列。 */
export async function buildDiagnostics(input: DiagnosticsInput): Promise<string> {
	const report = {
		generatedAt: new Date(input.now).toISOString(),
		app: {
			protocolVersion: input.protocolVersion,
			node: process.version,
			platform: `${platform()} ${release()}`,
			arch: arch(),
		},
		host: {
			hostId: input.hostId,
			hostName: input.hostName,
			agentDir: input.agentDir,
			dataDir: input.dataDir,
			sessionDir: input.sessionDir ?? null,
			authFileSize: (await fileSize(`${input.agentDir}/auth.json`)) ?? null,
			projectsFileSize: (await fileSize(`${input.dataDir}/projects.json`)) ?? null,
			settingsFileSize: (await fileSize(`${input.dataDir}/settings.json`)) ?? null,
		},
		counts: {
			sessions: input.sessionCount,
			projects: input.projects.length,
			providers: input.providers.length,
			configuredProviders: input.providers.filter((provider) => provider.authenticated).length,
		},
		providers: input.providers.map((provider) => ({
			id: provider.id,
			authenticated: provider.authenticated,
			modelCount: provider.modelCount,
			authSource: provider.authSource ?? null,
		})),
		projects: input.projects.map((project) => ({ cwd: project.cwd, name: project.name ?? null })),
		settings: input.settings,
	};
	return `${JSON.stringify(report, null, 2)}\n`;
}
