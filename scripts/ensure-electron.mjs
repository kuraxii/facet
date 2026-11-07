import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

function log(message) {
	console.log(`[facet] ${message}`);
}

if (process.env.FACET_SKIP_ELECTRON_DOWNLOAD === "1") {
	log("已按 FACET_SKIP_ELECTRON_DOWNLOAD=1 跳过 Electron 二进制检查");
	process.exit(0);
}

let electronDir;
try {
	electronDir = dirname(require.resolve("electron/package.json"));
} catch {
	log("未找到 electron 包，跳过二进制检查");
	process.exit(0);
}

const pathFile = join(electronDir, "path.txt");

if (existsSync(pathFile)) {
	const binary = join(electronDir, "dist", readFileSync(pathFile, "utf-8").trim());
	if (existsSync(binary)) {
		log(`Electron 二进制已就位：${binary}`);
		process.exit(0);
	}
}

log("下载 Electron 二进制，首次执行约 100MB");

try {
	execFileSync(process.execPath, [join(electronDir, "install.js")], { stdio: "inherit" });
} catch {
	log("Electron 二进制下载失败");
	log("可设置镜像后重试：export ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/");
	log("重试命令：node node_modules/electron/install.js");
	process.exit(1);
}

const binary = join(electronDir, "dist", readFileSync(pathFile, "utf-8").trim());
if (!existsSync(binary)) {
	log(`下载完成但未找到可执行文件：${binary}`);
	process.exit(1);
}

log(`Electron 二进制已就位：${binary}`);
