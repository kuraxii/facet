/**
 * 原子写入。
 *
 * 先写同目录下的临时文件再改名，中途中断不会留下半个文件；改名失败时把临时文件删掉。
 * 同一个文件的多份写入由调用方排队，这里只保证单次写入的完整。
 */
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** 把内容整体写到文件，写成功即整个替换。 */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
	const temp = `${file}.${randomUUID()}.tmp`;
	await mkdir(dirname(file), { recursive: true });
	try {
		await writeFile(temp, content, "utf8");
		await rename(temp, file);
	} catch (error) {
		await rm(temp, { force: true }).catch(() => undefined);
		throw error;
	}
}
