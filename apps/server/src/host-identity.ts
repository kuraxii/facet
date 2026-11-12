/**
 * 主机身份。
 *
 * 主机的标识由本机 machine-id 派生并缓存在数据目录的 host.json 里：同一台机器上的多个
 * 主机（不同数据目录）各不相同，同一数据目录重启后保持不变。
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { writeFileAtomic } from "@facet/agent";

/** 主机标识的取值来源。 */
export type HostSource = "machine-id" | "timestamp";

/** 主机身份。 */
export interface HostIdentity {
	/** 主机标识，20 位小写十六进制 */
	readonly id: string;
	/** 标识的派生来源：本机 machine-id，或时间戳兜底 */
	readonly source: HostSource;
	/** 首次生成时间，UTC 毫秒 */
	readonly createdAt: number;
}

export interface HostIdentityOptions {
	/** 主机数据目录，host.json 落在这里 */
	dataDir: string;
	/** machine-id 文件路径，测试时替换 */
	machineIdPath?: string;
	/** 当前时间，测试时替换 */
	now?: () => number;
}

/** 缺省的 machine-id 文件位置。 */
const DEFAULT_MACHINE_ID_PATH = "/etc/machine-id";

/** host.json 里的文件结构。 */
interface HostFile {
	/** 结构版本，读取时认不出就当作损坏并重新生成 */
	version: 1;
	/** 主机标识，20 位小写十六进制 */
	id: string;
	/** 标识的派生来源 */
	source: HostSource;
	/** 首次生成时间，UTC 毫秒 */
	createdAt: number;
}

/** 标识的形态：20 位小写十六进制。 */
const ID_PATTERN = /^[0-9a-f]{20}$/;

/**
 * 读取主机标识，没有则生成并写入。
 *
 * 生成是确定性的（machine-id 与数据目录都参与），因此同一数据目录被两个进程同时初始化时
 * 得到同一个标识，谁最后写入都一致。host.json 读坏时改名留档再重新生成。
 */
export async function loadOrCreateHostId(options: HostIdentityOptions): Promise<HostIdentity> {
	const file = join(options.dataDir, "host.json");
	const existing = await readHostFile(file);
	if (existing !== undefined) {
		return existing;
	}

	const now = options.now ?? Date.now;
	const machineId = await readMachineId(options.machineIdPath ?? DEFAULT_MACHINE_ID_PATH);
	// 掺入数据目录：同一台机器上的多个主机（开发实例、正式实例、第二套数据集）要能分开，
	// 否则侧栏并列时分辨不出，按主机记的偏好也会串。
	const material =
		machineId === undefined
			? // 没有 machine-id 时用时间戳兜底；再掺一个随机串，避免两台机器同毫秒启动撞在一起。
				`facet-${now()}-${randomUUID()}`
			: `facet-${machineId}-${resolve(options.dataDir)}`;
	const identity: HostIdentity = {
		id: createHash("sha256").update(material).digest("hex").slice(0, 20),
		source: machineId === undefined ? "timestamp" : "machine-id",
		createdAt: now(),
	};
	await writeFileAtomic(file, `${JSON.stringify(hostFileOf(identity), null, 2)}\n`);
	return identity;
}

/** 读 host.json；文件不存在或内容不可用时返回 undefined，不可用的文件改名留档。 */
async function readHostFile(file: string): Promise<HostIdentity | undefined> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch {
		return undefined;
	}
	const parsed = parseHostFile(text);
	if (parsed !== undefined) {
		return parsed;
	}
	await rename(file, `${file}.broken-${Date.now()}`).catch(() => undefined);
	return undefined;
}

/** 校验 host.json 的内容，字段不全或取值不合规时返回 undefined。 */
function parseHostFile(text: string): HostIdentity | undefined {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return undefined;
	}
	if (typeof data !== "object" || data === null) {
		return undefined;
	}
	const { id, source, createdAt } = data as Partial<HostFile>;
	if (typeof id !== "string" || !ID_PATTERN.test(id)) {
		return undefined;
	}
	if (source !== "machine-id" && source !== "timestamp") {
		return undefined;
	}
	if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
		return undefined;
	}
	return { id, source, createdAt };
}

/** 把身份转成写入文件的结构。 */
function hostFileOf(identity: HostIdentity): HostFile {
	return { version: 1, id: identity.id, source: identity.source, createdAt: identity.createdAt };
}

/** 读 machine-id，读不到或内容为空时返回 undefined。 */
async function readMachineId(path: string): Promise<string | undefined> {
	try {
		const text = (await readFile(path, "utf8")).trim();
		return text.length > 0 ? text : undefined;
	} catch {
		return undefined;
	}
}
