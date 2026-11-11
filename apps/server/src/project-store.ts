/**
 * 项目清单的持久化。
 *
 * 清单写在 `$XDG_DATA_HOME/facet/projects.json`，没有设置时落在 `~/.local/share/facet`。
 * 只有 Linux 走 XDG 规范；写入先落临时文件再改名，避免中途中断留下半个文件。
 */
import { readFile, rename } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { normalizeProjectPath, projectIdOf, writeFileAtomic } from "@facet/agent";

/** 清单文件格式版本，读取时按它判断能否兼容。 */
const FILE_VERSION = 1;

/** 清单里的一条项目。 */
export interface StoredProject {
	/** 由 cwd 派生的标识，与扫描结果里的标识一致 */
	id: string;
	/** 项目目录，绝对路径 */
	cwd: string;
	/** 用户设置的显示名，空表示按目录名显示 */
	name: string | undefined;
	/** 添加时间，Unix 毫秒 */
	createdAt: number;
}

/** 打开清单的参数。 */
export interface ProjectStoreOptions {
	/** 清单文件路径 */
	file: string;
}

/** 同一个目录重复添加。 */
export class ProjectExistsError extends Error {
	readonly cwd: string;

	constructor(cwd: string) {
		super(`项目已在清单里:${cwd}`);
		this.name = "ProjectExistsError";
		this.cwd = cwd;
	}
}

/** 按标识找不到项目。 */
export class ProjectNotFoundError extends Error {
	readonly id: string;

	constructor(id: string) {
		super(`项目不存在:${id}`);
		this.name = "ProjectNotFoundError";
		this.id = id;
	}
}

/** 显示名去掉首尾空白，空串按未设置处理。 */
function normalizeName(name: string | undefined): string | undefined {
	const trimmed = name?.trim();
	return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** 校验一条读进来的记录，不合理时返回空。 */
function parseProject(value: unknown): StoredProject | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return undefined;
	}
	const record = value as Record<string, unknown>;
	const cwd = typeof record.cwd === "string" ? normalizeProjectPath(record.cwd) : "";
	if (cwd.length === 0) {
		return undefined;
	}
	const name = typeof record.name === "string" ? normalizeName(record.name) : undefined;
	const createdAt = typeof record.createdAt === "number" ? record.createdAt : 0;
	return { id: projectIdOf(cwd), cwd, name, createdAt };
}

export class ProjectStore {
	private readonly file: string;
	/** 当前清单。改动先写进副本，写入磁盘成功之后才替换它 */
	private projects = new Map<string, StoredProject>();
	/** 串行化的操作队列，前一次失败不影响后一次 */
	private tail: Promise<unknown> = Promise.resolve();

	private constructor(file: string) {
		this.file = file;
	}

	/** 打开清单。文件不存在时得到空清单，内容无法解析时把原文件改名留档。 */
	static async open(options: ProjectStoreOptions): Promise<ProjectStore> {
		const store = new ProjectStore(options.file);
		await store.load();
		return store;
	}

	/** 清单文件路径。 */
	get path(): string {
		return this.file;
	}

	/** 当前清单，按添加顺序。 */
	list(): readonly StoredProject[] {
		return [...this.projects.values()];
	}

	/** 按标识取一条。 */
	get(id: string): StoredProject | undefined {
		return this.projects.get(id);
	}

	/** 添加一个项目。目录重复或不是绝对路径时报错。 */
	async add(input: { cwd: string; name?: string }): Promise<StoredProject> {
		if (!isAbsolute(input.cwd)) {
			throw new Error(`项目目录必须是绝对路径:${input.cwd}`);
		}
		const cwd = normalizeProjectPath(input.cwd);
		return await this.transact((draft) => {
			if ([...draft.values()].some((project) => project.cwd === cwd)) {
				throw new ProjectExistsError(cwd);
			}
			const project: StoredProject = {
				id: projectIdOf(cwd),
				cwd,
				name: normalizeName(input.name),
				createdAt: Date.now(),
			};
			draft.set(project.id, project);
			return project;
		});
	}

	/** 改名。名称为空时清除自定义名，按目录名显示。 */
	async rename(id: string, name: string | undefined): Promise<StoredProject> {
		return await this.transact((draft) => {
			const current = draft.get(id);
			if (!current) {
				throw new ProjectNotFoundError(id);
			}
			const next: StoredProject = { ...current, name: normalizeName(name) };
			draft.set(id, next);
			return next;
		});
	}

	/** 移除一个项目。 */
	async remove(id: string): Promise<void> {
		await this.transact((draft) => {
			if (!draft.delete(id)) {
				throw new ProjectNotFoundError(id);
			}
		});
	}

	/**
	 * 一次改动：读当前清单 → 在副本上改 → 写盘 → 替换内存。
	 *
	 * 整段排进同一条队列，所以并发调用看到的一定是前一次的结果，不会互相覆盖。写入失败时
	 * 内存保持原样，界面读到的与磁盘上的始终一致，调用方可以直接重试。
	 */
	private async transact<T>(work: (draft: Map<string, StoredProject>) => T): Promise<T> {
		return await this.exclusive(async () => {
			const draft = new Map(this.projects);
			const result = work(draft);
			await this.write(draft);
			this.projects = draft;
			return result;
		});
	}

	/** 把操作排进队列。队列只保证顺序，失败不牵动前后的操作。 */
	private async exclusive<T>(work: () => Promise<T>): Promise<T> {
		const run = this.tail.catch(() => undefined).then(work);
		this.tail = run.catch(() => undefined);
		return await run;
	}

	private async load(): Promise<void> {
		let text: string;
		try {
			text = await readFile(this.file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return;
			}
			throw error;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			await this.keepBrokenFile();
			return;
		}
		const record = parsed as { version?: unknown; projects?: unknown };
		if (record.version !== FILE_VERSION || !Array.isArray(record.projects)) {
			await this.keepBrokenFile();
			return;
		}
		for (const item of record.projects) {
			const project = parseProject(item);
			if (project && !this.projects.has(project.id)) {
				this.projects.set(project.id, project);
			}
		}
	}

	/** 把读不懂的文件改名留档，下次写入不会覆盖它。 */
	private async keepBrokenFile(): Promise<void> {
		await rename(this.file, `${this.file}.broken-${Date.now()}`).catch(() => undefined);
	}

	/** 整体写回。先写临时文件再改名，中途失败时临时文件不留。 */
	private async write(projects: Map<string, StoredProject>): Promise<void> {
		const payload = `${JSON.stringify({ version: FILE_VERSION, projects: [...projects.values()] }, null, 2)}\n`;
		await writeFileAtomic(this.file, payload);
	}
}
