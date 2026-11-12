/**
 * 项目清单。
 *
 * 启动时扫描会话目录并把结果留在内存里，供主机内的其他组件读取。
 * 扫描只负责提取，目录是否存在等条件由使用方自行筛选。
 */
import type { SessionProject } from "@facet/agent";

/** 项目来源，测试时替换成假的实现。 */
export interface ProjectSource {
	scanProjects(): Promise<SessionProject[]>;
}

export class ProjectCatalog {
	private readonly source: ProjectSource;
	private readonly projects = new Map<string, SessionProject>();
	/** 进行中的扫描，并发调用共用一个 */
	private pending: Promise<readonly SessionProject[]> | undefined;

	constructor(source: ProjectSource) {
		this.source = source;
	}

	/** 当前清单，按最近使用倒序。 */
	list(): readonly SessionProject[] {
		return [...this.projects.values()].sort((left, right) => {
			if (right.lastUsed !== left.lastUsed) {
				return right.lastUsed - left.lastUsed;
			}
			return left.cwd.localeCompare(right.cwd);
		});
	}

	/** 按标识取一条。 */
	get(id: string): SessionProject | undefined {
		return this.projects.get(id);
	}

	/** 重新扫描并整体替换清单；并发调用共用同一次扫描。 */
	refresh(): Promise<readonly SessionProject[]> {
		if (this.pending) {
			return this.pending;
		}
		this.pending = this.source
			.scanProjects()
			.then((projects) => {
				this.projects.clear();
				for (const project of projects) {
					this.projects.set(project.id, project);
				}
				return this.list();
			})
			.finally(() => {
				this.pending = undefined;
			});
		return this.pending;
	}
}
