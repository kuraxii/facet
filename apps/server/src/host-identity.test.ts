/**
 * 主机身份的测试。
 *
 * 覆盖 machine-id 派生、时间戳兜底、已有文件的复用、读坏留档，以及同机多数据目录分开。
 */
import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type HostIdentity, loadOrCreateHostId } from "./host-identity.ts";

/** 建一个临时目录，machine-id 文件也放进去。 */
async function makeDirs(): Promise<{ root: string; dataDir: string; machineIdPath: string }> {
	const root = await mkdtemp(join(tmpdir(), "facet-host-"));
	return { root, dataDir: join(root, "data"), machineIdPath: join(root, "machine-id") };
}

/** 标识的形态：20 位小写十六进制。 */
const ID_PATTERN = /^[0-9a-f]{20}$/;

describe("loadOrCreateHostId", () => {
	it("有 machine-id 时由它派生，同一数据目录反复读取不变", async () => {
		const { dataDir, machineIdPath } = await makeDirs();
		await writeFile(machineIdPath, "c8a8c6e36ba244a79ba7fd73c8ee52f8\n", "utf8");
		const first = await loadOrCreateHostId({ dataDir, machineIdPath });
		expect(first.source).toBe("machine-id");
		expect(first.id).toMatch(ID_PATTERN);
		const second = await loadOrCreateHostId({ dataDir, machineIdPath });
		expect(second).toEqual(first);
	});

	it("已有 host.json 时直接复用，machine-id 变了也不换标识", async () => {
		const { dataDir, machineIdPath } = await makeDirs();
		await writeFile(machineIdPath, "aaa", "utf8");
		const first = await loadOrCreateHostId({ dataDir, machineIdPath });
		await writeFile(machineIdPath, "bbb", "utf8");
		const second = await loadOrCreateHostId({ dataDir, machineIdPath });
		expect(second.id).toBe(first.id);
	});

	it("machine-id 文件不存在时用时间戳兜底", async () => {
		const { dataDir, machineIdPath } = await makeDirs();
		const identity = await loadOrCreateHostId({ dataDir, machineIdPath, now: () => 1_700_000_000_000 });
		expect(identity.source).toBe("timestamp");
		expect(identity.createdAt).toBe(1_700_000_000_000);
		expect(identity.id).toMatch(ID_PATTERN);
	});

	it("machine-id 内容为空时同样走时间戳兜底", async () => {
		const { dataDir, machineIdPath } = await makeDirs();
		await writeFile(machineIdPath, "  \n", "utf8");
		const identity = await loadOrCreateHostId({ dataDir, machineIdPath });
		expect(identity.source).toBe("timestamp");
	});

	it("同一 machine-id 的两份数据目录得到不同标识", async () => {
		const { root, dataDir, machineIdPath } = await makeDirs();
		await writeFile(machineIdPath, "same-machine", "utf8");
		const first = await loadOrCreateHostId({ dataDir, machineIdPath });
		const second = await loadOrCreateHostId({ dataDir: join(root, "data-2"), machineIdPath });
		expect(first.id).not.toBe(second.id);
	});

	it("同毫秒兜底时不同数据目录仍得到不同标识", async () => {
		const { root, dataDir, machineIdPath } = await makeDirs();
		const now = () => 1_700_000_000_000;
		const first = await loadOrCreateHostId({ dataDir, machineIdPath, now });
		const second = await loadOrCreateHostId({ dataDir: join(root, "other"), machineIdPath, now });
		expect(first.id).not.toBe(second.id);
	});

	it("host.json 读坏时改名留档并重新生成", async () => {
		const { dataDir, machineIdPath } = await makeDirs();
		await writeFile(machineIdPath, "machine", "utf8");
		await mkdir(dataDir, { recursive: true });
		await writeFile(join(dataDir, "host.json"), "{ not json", "utf8");
		const identity = await loadOrCreateHostId({ dataDir, machineIdPath });
		expect(identity.id).toMatch(ID_PATTERN);
		const files = await readdir(dataDir);
		expect(files.some((name) => name.startsWith("host.json.broken-"))).toBe(true);
	});

	it("写入的 host.json 带版本、来源与生成时间", async () => {
		const { dataDir, machineIdPath } = await makeDirs();
		await writeFile(machineIdPath, "machine", "utf8");
		const identity: HostIdentity = await loadOrCreateHostId({ dataDir, machineIdPath });
		const text = await readFile(join(dataDir, "host.json"), "utf8");
		expect(JSON.parse(text)).toEqual({
			version: 1,
			id: identity.id,
			source: identity.source,
			createdAt: identity.createdAt,
		});
	});
});
