/**
 * 打包独立的 server 产物。
 *
 * 产物是一个自带官方 Node 运行时的目录：
 *
 *   dist-server/
 *     bin/node            官方 Node（当前 LTS，随发行包分发）；Windows 上是 bin/node.exe
 *     lib/server.mjs      server 入口，esbuild 打成单个 ES 模块（源码里有顶层 await）
 *     lib/pty-server.mjs  终端子进程入口
 *     lib/worker.js       codemode 脚本的沙箱 worker（pi 的沙箱在自己的线程里跑脚本）
 *     lib/node_modules/node-pty/   原生模块（终端）
 *     lib/node_modules/quickjs-wasi/quickjs.wasm   codemode 用的 wasm 虚拟机
 *
 * 桌面打包后把整个目录放进 `resources/server`；server 用 `bin/node lib/server.mjs` 启动，
 * 与桌面那份 Electron 运行时互不相干。
 *
 * 用法：node scripts/build-server.mjs [--node 26.13.1]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, copyFile, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "apps/desktop/dist-server");
const cacheDir = join(homedir(), ".cache", "facet-node");

/**
 * 自带的 Node 版本。
 *
 * 以仓库根的 `.node-version` 为准，开发机与发行包因此用同一个版本；命令行参数优先生效。
 */
const DEFAULT_NODE_VERSION = "26.13.1";

const nodeVersion = readNodeVersion() ?? DEFAULT_NODE_VERSION;

/**
 * 目标平台。
 *
 * 按宿主平台打一份：自带的 Node 运行时与 node-pty 的原生产物都按平台取，交叉打包要另一套
 * 工具链，这里不猜也不声明。官方 Node 的发行包命名把 `win32` 写作 `win`，其余与
 * `process.platform` 一致。
 */
const isWindows = process.platform === "win32";
const nodePlatform = isWindows ? "win" : process.platform;

/** 运行时目录里可执行文件的名字，Windows 带 `.exe`。 */
const NODE_EXECUTABLE = isWindows ? "node.exe" : "node";

/**
 * 取官方 Node 运行时。
 *
 * 只在缓存目录里下载与解包：缓存随时可以删，删了下次打包会重新下。Linux 与 macOS 的发行包
 * 是 tar.xz，Windows 是 zip，两种都用 bsdtar 解；`bin/node` 与 `node.exe` 的位置也不同。
 */
async function ensureNodeBinary() {
	const tag = `node-v${nodeVersion}-${nodePlatform}-${process.arch}`;
	const extension = isWindows ? ".zip" : ".tar.xz";
	const archive = join(cacheDir, `${tag}${extension}`);
	const extracted = join(cacheDir, tag);
	const binary = isWindows ? join(extracted, NODE_EXECUTABLE) : join(extracted, "bin", NODE_EXECUTABLE);
	if (existsSync(binary)) {
		return binary;
	}
	await mkdir(cacheDir, { recursive: true });
	if (!existsSync(archive)) {
		const url = `https://nodejs.org/dist/v${nodeVersion}/${tag}${extension}`;
		console.log(`[server] 下载 ${url}`);
		await download(url, archive);
	}
	execFileSync("tar", ["-xf", archive, "-C", cacheDir], { stdio: "inherit" });
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
		target: "node26",
		// 需要读自己目录里文件的模块只能外置，跟着产物一起拷过去：node-pty 找 .node，
		// photon 找与自身同目录的 wasm
		external: ["node-pty", "@silvia-odwyer/photon-node"],
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

/**
 * 拷 pi 的扩展转译器。
 *
 * pi 的 jiti 加载器用 `createRequire(import.meta.url)("../dist/babel.cjs")` 取转译器；
 * 打进单文件后 `import.meta.url` 指向 `<产物>/lib/server.mjs`，于是它会去
 * `<产物>/dist/babel.cjs` 找。缺这个文件时所有文件扩展都加载失败，错误只进扩展 issues。
 */
async function copyExtensionTransform(target) {
	const source = join(root, "node_modules", "jiti", "dist", "babel.cjs");
	await mkdir(target, { recursive: true });
	await copyFile(source, join(target, "babel.cjs"));
}

/**
 * 只拷 node-pty 跑起来需要的那部分。
 *
 * 编译产物与预编译产物按平台取：Windows 安装脚本在没有编译工具链时不会生成
 * `build/Release/*.node`，运行时走 `prebuilds/win32-<arch>`；Linux 与 macOS 由 `npm ci`
 * 就地编译，别的平台的目录带过去也用不上。
 */
async function copyNodePty(target) {
	const source = join(root, "node_modules", "node-pty");
	await mkdir(target, { recursive: true });
	for (const item of ["lib", "package.json", "LICENSE"]) {
		await cp(join(source, item), join(target, item), { recursive: true });
	}
	// build 目录不一定有：没有编译过的机器上只有 postinstall 拷过来的 conpty 运行时
	if (existsSync(join(source, "build"))) {
		await cp(join(source, "build"), join(target, "build"), { recursive: true });
	}
	const prebuild = join(source, "prebuilds", `${process.platform}-${process.arch}`);
	if (existsSync(prebuild)) {
		await cp(prebuild, join(target, "prebuilds", `${process.platform}-${process.arch}`), { recursive: true });
	}
	await rm(join(target, "build", "Release", "obj.target"), { recursive: true, force: true });
}

/** 递归统计产物体积，`du` 只有 unix 有。 */
async function directorySize(dir) {
	let total = 0;
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		total += entry.isDirectory() ? await directorySize(path) : (await stat(path)).size;
	}
	return total;
}

/** 拷 wasm 虚拟机、它的 JS 封装与 package.json；类型声明与扩展模块的 .so 用不上。 */
async function copyQuickJs(target) {
	const source = join(root, "node_modules", "quickjs-wasi");
	await mkdir(target, { recursive: true });
	for (const item of ["package.json", "quickjs.wasm", "LICENSE", "dist"]) {
		await cp(join(source, item), join(target, item), { recursive: true });
	}
}

/**
 * 拷图片缩放用的 Photon。
 *
 * pi 把消息里的图片缩到内联上限要用 Photon（Rust 编译成 wasm）。它按自己所在目录读
 * photon_rs_bg.wasm，esbuild 打成一个文件之后这个目录就没了；整包外置再原样拷过来，
 * 它才能按包内路径找到 wasm。缺了它，图片会被替换成一行说明文字，模型看不到图。
 */
async function copyPhoton(target) {
	const source = join(root, "node_modules", "@silvia-odwyer", "photon-node");
	await mkdir(target, { recursive: true });
	for (const item of ["package.json", "photon_rs.js", "photon_rs_bg.js", "photon_rs_bg.wasm", "LICENSE.md"]) {
		await copyFile(join(source, item), join(target, item));
	}
}

async function main() {
	console.log(`[server] 目标目录 ${outDir}`);
	await rm(outDir, { recursive: true, force: true });
	await mkdir(join(outDir, "bin"), { recursive: true });
	await mkdir(join(outDir, "lib"), { recursive: true });

	const node = await ensureNodeBinary();
	await copyFile(node, join(outDir, "bin", NODE_EXECUTABLE));
	// Windows 的可执行位由扩展名决定，没有权限位要设
	if (!isWindows) {
		await chmod(join(outDir, "bin", NODE_EXECUTABLE), 0o755);
	}
	console.log(`[server] 自带 Node ${nodeVersion}`);

	await bundle(join(root, "apps/server/src/main.ts"), join(outDir, "lib/server.mjs"));
	await bundle(join(root, "apps/server/src/pty-server-child.ts"), join(outDir, "lib/pty-server.mjs"));
	await copyExtensionTransform(join(outDir, "dist"));
	await copyNodePty(join(outDir, "lib", "node_modules", "node-pty"));

	// codemode 在自己的 worker 线程里跑脚本，worker 与 wasm 都要跟着产物走：
	// 沙箱按 server.mjs 的位置找 `lib/worker.js`，再按包名解析 `quickjs-wasi/quickjs.wasm`
	const piCodemode = join(root, "node_modules", "@earendil-works", "pi-codemode", "dist", "runtime");
	await bundle(join(piCodemode, "worker.js"), join(outDir, "lib", "worker.js"));
	await copyQuickJs(join(outDir, "lib", "node_modules", "quickjs-wasi"));
	await copyCodemodeRuntime(join(outDir, "lib"));
	await copyPhoton(join(outDir, "lib", "node_modules", "@silvia-odwyer", "photon-node"));

	const version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
	await writeFile(
		join(outDir, "package.json"),
		`${JSON.stringify({ name: "facet-server", version, private: true, main: "lib/server.mjs" }, null, 2)}\n`,
	);

	const megabytes = Math.round((await directorySize(outDir)) / (1024 * 1024));
	console.log(`[server] 完成：${megabytes}M`);
}

function readNodeVersion() {
	const index = process.argv.indexOf("--node");
	if (index >= 0) {
		const value = process.argv[index + 1]?.trim();
		if (value !== undefined && value.length > 0) {
			return value;
		}
	}
	// .node-version 是开发机与发行包的共同版本号，读不到时用内置的缺省值
	try {
		const value = readFileSync(join(root, ".node-version"), "utf8").trim();
		return value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

await main();
