/**
 * 打包独立的主机产物。
 *
 * 产物是一个自带官方 Node 运行时的目录：
 *
 *   dist-host/
 *     bin/node          官方 Node（与 engines 要求一致的 LTS）
 *     lib/host.mjs      主机入口，esbuild 打成单个 ES 模块（源码里有顶层 await）
 *     lib/pty-host.mjs  终端子进程入口
 *     lib/node_modules/node-pty/   唯一的原生模块
 *
 * 桌面打包后把整个目录放进 `resources/host`，远程主机也把这个目录拷过去就行。
 * 主机进程用 `bin/node lib/host.js` 启动，与桌面那份 Electron 运行时互不相干。
 *
 * 用法：node scripts/build-host.mjs [--node 22.21.0]
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "apps/desktop/dist-host");
const cacheDir = join(homedir(), ".cache", "facet-node");

/** 自带的 Node 版本。要换版本改这里，或传 `--node <版本>`。 */
const DEFAULT_NODE_VERSION = "22.21.0";

const nodeVersion = readNodeVersion() ?? DEFAULT_NODE_VERSION;

/**
 * 取官方 Node 运行时。
 *
 * 只在缓存目录里下载与解包：缓存随时可以删，删了下次打包会重新下。
 */
async function ensureNodeBinary() {
	const tag = `node-v${nodeVersion}-linux-x64`;
	const tar = join(cacheDir, `${tag}.tar.xz`);
	const extracted = join(cacheDir, tag);
	const binary = join(extracted, "bin", "node");
	if (existsSync(binary)) {
		return binary;
	}
	await mkdir(cacheDir, { recursive: true });
	if (!existsSync(tar)) {
		const url = `https://nodejs.org/dist/v${nodeVersion}/${tag}.tar.xz`;
		console.log(`[host] 下载 ${url}`);
		await download(url, tar);
	}
	execFileSync("tar", ["xJf", tar, "-C", cacheDir], { stdio: "inherit" });
	if (!existsSync(binary)) {
		throw new Error(`解包后没有找到 ${binary}`);
	}
	return binary;
}

/** 用 fetch 写文件，避免额外依赖。 */
async function download(url, file) {
	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`下载失败 ${response.status} ${url}`);
	}
	await writeFile(file, Buffer.from(await response.arrayBuffer()));
}

/** 打一个 ES 模块单文件。 */
async function bundle(entry, outfile) {
	await build({
		entryPoints: [entry],
		outfile,
		bundle: true,
		platform: "node",
		format: "esm",
		target: "node22",
		// 原生模块只能外置，跟着产物一起拷过去
		external: ["node-pty"],
		// 源码里的 .ts 相对导入由 esbuild 直接处理
		resolveExtensions: [".ts", ".js", ".json"],
		// 依赖里还有 CJS 包（cross-spawn 之类）用 require 取内置模块，ES 输出下要给它们一个
		// 真的 require，否则 esbuild 的 shim 会抛「Dynamic require is not supported」
		banner: {
			js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
		},
		logLevel: "warning",
		define: { "process.env.NODE_ENV": '"production"' },
	});
}

/** 只拷 node-pty 跑起来需要的那部分。 */
async function copyNodePty(target) {
	const source = join(root, "node_modules", "node-pty");
	await mkdir(target, { recursive: true });
	for (const item of ["lib", "build", "package.json", "LICENSE"]) {
		await cp(join(source, item), join(target, item), { recursive: true });
	}
	// 预编译产物留给别的平台，本产物只要 linux-x64 的 build 结果
	await rm(join(target, "build", "Release", "obj.target"), { recursive: true, force: true });
}

async function main() {
	console.log(`[host] 目标目录 ${outDir}`);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(join(outDir, "bin"), { recursive: true });
	await mkdir(join(outDir, "lib"), { recursive: true });

	const node = await ensureNodeBinary();
	await copyFile(node, join(outDir, "bin", "node"));
	await chmod(join(outDir, "bin", "node"), 0o755);
	console.log(`[host] 自带 Node ${nodeVersion}`);

	await bundle(join(root, "apps/server/src/main.ts"), join(outDir, "lib/host.mjs"));
	await bundle(join(root, "apps/server/src/pty-host-child.ts"), join(outDir, "lib/pty-host.mjs"));
	await copyNodePty(join(outDir, "lib", "node_modules", "node-pty"));

	const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
	await writeFile(
		join(outDir, "package.json"),
		`${JSON.stringify({ name: "facet-host", version, private: true, main: "lib/host.mjs" }, null, 2)}\n`,
	);

	const listing = execFileSync("du", ["-sh", outDir], { encoding: "utf8" }).trim();
	console.log(`[host] 完成：${listing}`);
}

function readNodeVersion() {
	const index = process.argv.indexOf("--node");
	if (index < 0) {
		return undefined;
	}
	const value = process.argv[index + 1]?.trim();
	return value !== undefined && value.length > 0 ? value : undefined;
}

await main();
