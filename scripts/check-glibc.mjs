#!/usr/bin/env node
/**
 * 检查 Linux 产物里每个 ELF 需要的最高 GLIBC 符号版本。
 *
 * 原生模块由构建机现场编译，符号版本跟着构建机的 glibc 走：在 Ubuntu 24.04 上编出来的
 * `pty.node` 会要 2.39，装到 Ubuntu 20.04（glibc 2.31）上直接起不来。这条检查把上限钉死，
 * 免得「构建机上能跑、发出去跑不了」的问题悄悄溜过去。
 *
 * 用法：
 *   node scripts/check-glibc.mjs [目录] [--max 2.31]
 *
 * 目录缺省 `apps/desktop/dist`，只扫其中 `*-unpacked` 的解包目录（打包前的可执行文件都在
 * 那里；归档文件本身不是 ELF，扫了也只是白读几百兆）。electron-builder 在 arm64 上把解包
 * 目录叫 `linux-arm64-unpacked`，所以不写死名字。超过上限时逐个列出并以退出码 1 结束。
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** 缺省的产物目录与符号版本上限。 */
const DEFAULT_DIR = "apps/desktop/dist";
const DEFAULT_MAX = "2.31";

/**
 * 把 `1.2.3` 这样的版本串拆成数字数组，比较时逐段按数值走。
 *
 * 不能直接按字符串比：`2.9` 与 `2.17` 字典序会把后者排在前面，而实际是前者更旧。
 */
function parseVersion(text) {
	return text.split(".").map((part) => Number.parseInt(part, 10));
}

/** 两个版本串谁更新；相等返回 0。 */
function compareVersions(left, right) {
	const a = parseVersion(left);
	const b = parseVersion(right);
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index += 1) {
		const diff = (a[index] ?? 0) - (b[index] ?? 0);
		if (diff !== 0) {
			return diff;
		}
	}
	return 0;
}

/** 是不是 ELF 文件：看开头四个字节的魔数。 */
function isElf(path) {
	try {
		const head = readFileSync(path).subarray(0, 4);
		return head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
	} catch {
		return false;
	}
}

/** 递归列出目录下所有文件。 */
function listFiles(root) {
	const out = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(path);
			} else if (entry.isFile()) {
				out.push(path);
			}
			// 符号链接不跟进去：它指向的文件在别处，由那份文件自己检查
		}
	};
	walk(root);
	return out;
}

/** 读一个 ELF 需要的最高 GLIBC 版本；不是动态链接的 ELF 时给 undefined。 */
function maxGlibcVersion(path) {
	const output = execFileSync("readelf", ["--version-info", path], {
		encoding: "utf8",
		// 不是 ELF 或没有版本段时 readelf 会非零退出，按「没有要求」处理
		stdio: ["ignore", "pipe", "ignore"],
	});
	const versions = output.match(/GLIBC_(\d+(?:\.\d+)*)/g) ?? [];
	let max;
	for (const token of versions) {
		const value = token.slice("GLIBC_".length);
		if (max === undefined || compareVersions(value, max) > 0) {
			max = value;
		}
	}
	return max;
}

const args = process.argv.slice(2);
let dir = DEFAULT_DIR;
let max = DEFAULT_MAX;
for (let index = 0; index < args.length; index += 1) {
	const arg = args[index];
	if (arg === "--max") {
		max = args[index + 1] ?? max;
		index += 1;
	} else if (!arg.startsWith("-")) {
		dir = arg;
	}
}

// 顶层给的产物目录：里面可能有 rpm/deb/tar.gz 与一到多个 `*-unpacked` 解包目录，
// 只扫后者；直接指到解包目录时原样扫
const isUnpackedRoot = /unpacked/.test(dir);
const roots = isUnpackedRoot
	? [dir]
	: readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && entry.name.includes("unpacked"))
			.map((entry) => join(dir, entry.name));
if (roots.length === 0) {
	console.log(`${dir} 下没有找到 *-unpacked 目录`);
	process.exit(1);
}

const files = roots.flatMap((root) => listFiles(root));
const over = [];
let checked = 0;
for (const file of files) {
	if (!isElf(file)) {
		continue;
	}
	const version = maxGlibcVersion(file);
	if (version === undefined) {
		continue;
	}
	checked += 1;
	if (compareVersions(version, max) > 0) {
		over.push({ file, version });
	}
}

if (over.length > 0) {
	for (const item of over) {
		console.log(`✗ 需要 GLIBC_${item.version}（上限 ${max}）：${item.file}`);
	}
	process.exit(1);
}
console.log(`${checked} 个 ELF 全部不超过 GLIBC_${max}`);
