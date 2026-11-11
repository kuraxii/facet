/**
 * 凭证文件。
 *
 * 存在 pi 的 `auth.json` 里，格式是一个按提供方 id 索引的对象，每项带类型标签
 * （`api_key` 或 `oauth`）。写入排队进行，先写临时文件再改名；读取时把读不懂的内容当作
 * 没有凭证，不让一个坏文件把整个会话流程挡住。
 *
 * 同类文件里 pi 自带一份实现，但它没有从包根导出；这里只做 facet 需要的那部分：读、
 * 列、替换、删除，并保证并发写入不互相覆盖。
 */
import { readFile, rename } from "node:fs/promises";
import type {
	AuthOperationOptions,
	Credential,
	CredentialInfo,
	CredentialStore,
} from "@earendil-works/pi-ai";
import { writeFileAtomic } from "./atomic-write.ts";

/** 凭证文件的原始内容。 */
type CredentialFile = Record<string, Credential>;

/** 磁盘上的内容不是我们认识的样子。 */
function isEmptyObject(value: unknown): value is CredentialFile {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 判断一条记录是不是带类型标签的凭证。 */
function isCredential(value: unknown): value is Credential {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const type = (value as { type?: unknown }).type;
	return type === "api_key" || type === "oauth";
}

/**
 * 基于文件的凭证存储。
 *
 * `modify` 见到的一定是上一次写入之后的内容：整段读改写排在同一条队列里，跨进程则由
 * 文件本身的写后改名保证不会读到半个文件。
 */
export class FileCredentialStore implements CredentialStore {
	private readonly file: string;
	/** 串行化的读改写队列 */
	private tail: Promise<unknown> = Promise.resolve();

	constructor(file: string) {
		this.file = file;
	}

	/** 凭证文件路径。 */
	get path(): string {
		return this.file;
	}

	async read(providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
		return (await this.load())[providerId];
	}

	async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
		const data = await this.load();
		return Object.entries(data)
			.filter((entry): entry is [string, Credential] => isCredential(entry[1]))
			.map(([providerId, credential]) => ({ providerId, type: credential.type }));
	}

	async modify(
		providerId: string,
		fn: (current: Credential | undefined) => Promise<Credential | undefined>,
		_options?: AuthOperationOptions,
	): Promise<Credential | undefined> {
		return await this.exclusive(async () => {
			const data = await this.load();
			const next = await fn(data[providerId]);
			if (next === undefined) {
				return data[providerId];
			}
			data[providerId] = next;
			await this.save(data);
			return next;
		});
	}

	async delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
		await this.exclusive(async () => {
			const data = await this.load();
			if (!(providerId in data)) {
				return;
			}
			delete data[providerId];
			await this.save(data);
		});
	}

	private async exclusive<T>(work: () => Promise<T>): Promise<T> {
		const run = this.tail.catch(() => undefined).then(work);
		this.tail = run.catch(() => undefined);
		return await run;
	}

	/** 读整份文件。文件不存在或内容读不懂时得到空对象。 */
	private async load(): Promise<CredentialFile> {
		let text: string;
		try {
			text = await readFile(this.file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return {};
			}
			throw error;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			await this.keepBrokenFile();
			return {};
		}
		return isEmptyObject(parsed) ? parsed : {};
	}

	private async save(data: CredentialFile): Promise<void> {
		await writeFileAtomic(this.file, `${JSON.stringify(data, null, 2)}\n`);
	}

	/** 把读不懂的文件改名留档，下次写入不会覆盖它。 */
	private async keepBrokenFile(): Promise<void> {
		await rename(this.file, `${this.file}.broken-${Date.now()}`).catch(() => undefined);
	}
}
