#!/usr/bin/env node
/**
 * 改版本号：由维护者在发版前手动跑一次。
 *
 * 版本写在仓库文件里——根 `package.json` 与 `apps/desktop/package.json`（产物名与
 * `app.getVersion()` 都取自后者）。发版流程是：跑本脚本指定版本 → 提交一次发布提交 →
 * 在这条提交上打 `v<版本>` 标签；流水线直接按仓库里的版本构建，不再从标签反填。
 *
 * 用法：
 *   node scripts/sync-version.mjs          # 只报告当前版本
 *   node scripts/sync-version.mjs 0.2.0    # 把两处都改成 0.2.0
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

/** 只接受 semver 的三段或带预发布后缀，避免把标签上的杂物写进 package.json。 */
const VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** 需要跟着变的文件：根是给人看的当前版本，desktop 那个才决定产物名。 */
const TARGETS = ["package.json", "apps/desktop/package.json"];

/** 改一个 package.json 的 version，保留原有缩进与其余内容。 */
function writeVersion(file, version) {
	const path = join(ROOT, file);
	const text = readFileSync(path, "utf8");
	const pattern = /("version":\s*)"[^"]*"/;
	if (!pattern.test(text)) {
		throw new Error(`${file} 里没有 version 字段`);
	}
	writeFileSync(path, text.replace(pattern, `$1"${version}"`));
}

/** 读一个 package.json 的当前版本。 */
function readVersion(file) {
	return JSON.parse(readFileSync(join(ROOT, file), "utf8")).version;
}

const requested = process.argv[2];

if (requested === undefined) {
	for (const file of TARGETS) {
		console.log(`${file}: ${readVersion(file)}`);
	}
	process.exit(0);
}

if (!VERSION_PATTERN.test(requested)) {
	console.error(`版本号不合法：${requested}`);
	process.exit(1);
}
for (const file of TARGETS) {
	writeVersion(file, requested);
	console.log(`${file}: ${requested}`);
}
