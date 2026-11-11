/**
 * 模型配置里的提供方条目。
 *
 * 只读写 `models.json` 里 `providers` 那一层的地址字段，其余内容原样保留：这个文件由 pi 与
 * 用户共同维护，facet 只负责其中的网关地址覆写。写入走临时文件加改名，读改写排队进行。
 */
import { readFile, rename } from "node:fs/promises";
import { writeFileAtomic } from "./atomic-write.ts";

/** 一个提供方在配置里的形状，只描述这里会碰到的字段。 */
interface ProviderEntry {
	baseUrl?: string;
	[key: string]: unknown;
}

/** 整份配置。 */
interface ModelConfigFile {
	providers?: Record<string, ProviderEntry>;
	[key: string]: unknown;
}

/** 打开配置的参数。 */
export interface ModelConfigStoreOptions {
	/** models.json 的路径 */
	file: string;
}

/** 地址不是能用的 URL。 */
export class InvalidBaseUrlError extends Error {
	readonly value: string;

	constructor(value: string) {
		super(`接口地址要以 http:// 或 https:// 开头:${value}`);
		this.name = "InvalidBaseUrlError";
		this.value = value;
	}
}

/** 校验并清理地址，空串表示恢复默认。 */
export function normalizeBaseUrl(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new InvalidBaseUrlError(trimmed);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new InvalidBaseUrlError(trimmed);
	}
	// 统一去掉末尾斜杠，拼接请求路径时不会出现两条
	return trimmed.replace(/\/+$/, "");
}

export class ModelConfigStore {
	private readonly file: string;
	/** 串行化的读改写队列 */
	private tail: Promise<unknown> = Promise.resolve();

	constructor(options: ModelConfigStoreOptions) {
		this.file = options.file;
	}

	/** 配置文件路径。 */
	get path(): string {
		return this.file;
	}

	/** 读一整份配置。文件不存在时为空对象。 */
	async read(): Promise<ModelConfigFile> {
		let text: string;
		try {
			text = await readFile(this.file, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return {};
			}
			throw error;
		}
		try {
			const parsed: unknown = JSON.parse(text);
			return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
				? (parsed as ModelConfigFile)
				: {};
		} catch {
			await rename(this.file, `${this.file}.broken-${Date.now()}`).catch(() => undefined);
			return {};
		}
	}

	/** 已配置的提供方地址，键为提供方 id。 */
	async overrides(): Promise<Record<string, string>> {
		const config = await this.read();
		const overrides: Record<string, string> = {};
		for (const [id, entry] of Object.entries(config.providers ?? {})) {
			if (typeof entry?.baseUrl === "string" && entry.baseUrl.length > 0) {
				overrides[id] = entry.baseUrl;
			}
		}
		return overrides;
	}

	/**
	 * 设置某个提供方的地址。
	 *
	 * 传空串表示恢复默认：删掉这个字段，条目里没有其他内容时连条目一起去掉，文件保持干净。
	 */
	async setBaseUrl(providerId: string, value: string): Promise<string | undefined> {
		const baseUrl = normalizeBaseUrl(value);
		return await this.exclusive(async () => {
			const config = await this.read();
			const providers = { ...(config.providers ?? {}) };
			const current = providers[providerId] ?? {};
			if (baseUrl === undefined) {
				const { baseUrl: _removed, ...rest } = current;
				if (Object.keys(rest).length === 0) {
					delete providers[providerId];
				} else {
					providers[providerId] = rest;
				}
			} else {
				providers[providerId] = { ...current, baseUrl };
			}
			await writeFileAtomic(this.file, `${JSON.stringify({ ...config, providers }, null, 2)}\n`);
			return baseUrl;
		});
	}

	private async exclusive<T>(work: () => Promise<T>): Promise<T> {
		const run = this.tail.catch(() => undefined).then(work);
		this.tail = run.catch(() => undefined);
		return await run;
	}
}
