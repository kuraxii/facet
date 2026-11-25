/**
 * 测试用的本机 socket 位置。
 *
 * Windows 没有 unix socket：`listen()` 只认命名管道，传一个文件系统路径会直接
 * `EACCES`。主机侧按 `config.ts` 的 `namedPipePath()` 算，测试也照同一条规则，两边才
 * 落到同一个名字上；其余平台上仍是临时目录里的 `.sock` 文件。
 */
import { join } from "node:path";
import { namedPipePath } from "./config.ts";

/**
 * 某个临时目录下的本机 socket 位置。
 *
 * `name` 用来区分同一个用例里的多台主机；管道名带的是目录摘要，临时目录每个用例都不同，
 * 所以并发跑的用例之间也不会撞名。
 */
export function testSocketPath(dir: string, name = "host"): string {
	return process.platform === "win32" ? namedPipePath(join(dir, name)) : join(dir, `${name}.sock`);
}
