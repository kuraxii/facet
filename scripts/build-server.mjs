/**
 * 打包独立的 server 产物。
 *
 * 产物是一个自带官方 Node 运行时的目录：
 *
 *   dist-server/
 *     bin/node            官方 Node（与 engines 要求一致的 LTS）
 *     lib/server.mjs      server 入口，esbuild 打成单个 ES 模块（源码里有顶层 await）
 *     lib/pty-server.mjs  终端子进程入口
 *     lib/worker.js       codemode 脚本的沙箱 worker（pi 的沙箱在自己的线程里跑脚本）
 *     lib/node_modules/node-pty/   原生模块（终端）
 *     lib/node_modules/quickjs-wasi/quickjs.wasm   codemode 用的 wasm 虚拟机
 *
 * 桌面打包后把整个目录放进 `resources/server`；server 用 `bin/node lib/server.mjs` 启动，
 * 与桌面那份 Electron 运行时互不相干。
 *
 * 用法：node scripts/build-server.mjs [--node 22.21.0]
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "apps/desktop/dist-server");
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
		console.log(`[server] 下载 ${url}`);
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

/**
 * 拷 pi-codemode 的 QuickJS 沙箱 worker 到产物里。
 *
 * server.mjs 单文件打包时，pi-codemode 的 `runtime/host.js` 里 `new Worker("./worker.js")`
 * 是相对 `import.meta.url` 解析的，而 worker 本身是个独立线程入口，不会被 esbuild 内联，
 * 因此必须把这些文件原样放到 `lib/` 下，否则 codemode 工具会报「Cannot find module worker.js」。
 */
async function copyCodemodeRuntime(target) {
	const source = join(root, "node_modules", "@earendil-works", "pi-codemode", "dist", "runtime");
	for (const item of ["worker.js", "protocol.js", "vm.js", "prelude-source.js"]) {
		await copyFile(join(source, item), join(target, item));
	}
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

/** 拷 wasm 虚拟机、它的 JS 封装与 package.json；类型声明与扩展模块的 .so 用不上。 */
async function copyQuickJs(target) {
	const source = join(root, "node_modules", "quickjs-wasi");
	await mkdir(target, { recursive: true });
	for (const item of ["package.json", "quickjs.wasm", "LICENSE", "dist"]) {
		await cp(join(source, item), join(target, item), { recursive: true });
	}
}

async function main() {
	console.log(`[server] 目标目录 ${outDir}`);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(join(outDir, "bin"), { recursive: true });
	await mkdir(join(outDir, "lib"), { recursive: true });

	const node = await ensureNodeBinary();
	await copyFile(node, join(outDir, "bin", "node"));
	await chmod(join(outDir, "bin", "node"), 0o755);
	console.log(`[server] 自带 Node ${nodeVersion}`);

	await bundle(join(root, "apps/server/src/main.ts"), join(outDir, "lib/server.mjs"));
	await bundle(join(root, "apps/server/src/pty-server-child.ts"), join(outDir, "lib/pty-server.mjs"));
	await copyNodePty(join(outDir, "lib", "node_modules", "node-pty"));

	// codemode 在自己的 worker 线程里跑脚本，worker 与 wasm 都要跟着产物走：
	// 沙箱按 server.mjs 的位置找 `lib/worker.js`，再按包名解析 `quickjs-wasi/quickjs.wasm`
	const piCodemode = join(root, "node_modules", "@earendil-works", "pi-codemode", "dist", "runtime");
	await bundle(join(piCodemode, "worker.js"), join(outDir, "lib", "worker.js"));
	await copyQuickJs(join(outDir, "lib", "node_modules", "quickjs-wasi"));
	await copyCodemodeRuntime(join(outDir, "lib"));

	const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
	await writeFile(
		join(outDir, "package.json"),
		`${JSON.stringify({ name: "facet-server", version, private: true, main: "lib/server.mjs" }, null, 2)}\n`,
	);

	const listing = execFileSync("du", ["-sh", outDir], { encoding: "utf8" }).trim();
	console.log(`[server] 完成：${listing}`);
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
