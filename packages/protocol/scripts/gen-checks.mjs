#!/usr/bin/env node
/**
 * 由 Schema 生成自包含的校验函数。
 *
 * TypeBox 的 `Code()` 输出的是一份 ESM 模块，开头固定带三条 `typebox/*` 的 import（Hashing、
 * Format、Guard）。本包的运行时代码不许依赖 typebox，所以这里把 import 段与 External 段摘掉，
 * 再把剩下的判断体包进一个具名函数；摘完先自检体里没有引用任何外部名字，再落盘。
 *
 * 用法：node scripts/gen-checks.mjs [--skip-tsc]
 * `--skip-tsc` 供 `pretypecheck` 使用：typecheck 本身就会用同一份配置检查生成物。
 */
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Code } from "typebox/compile";
import { DISPATCH_SCHEMAS, REQUEST_SCHEMAS, SERVER_FRAME_SCHEMAS } from "../src/schema/contracts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);
const outFile = join(packageRoot, "src/generated/checks.ts");

/** 生成体里不允许出现的外部名字：出现即说明摘 import 摘漏了。 */
const FORBIDDEN = ["typebox", "Hashing", "Format", "Guard", "CheckContext", "External", "require("];

/** 把一条 Schema 编译成自包含的判断体，返回入口函数名。 */
function compileEntry(label, schema) {
	const { Code: source } = Code(schema);
	const entryMatch = /export function Check\(value\) \{ return (\w+)\(value\) \}/.exec(source);
	if (entryMatch === null || entryMatch[1] === undefined) {
		throw new Error(`${label}: 生成物里找不到 Check 入口`);
	}
	const entry = entryMatch[1];
	const kept = [];
	let previous = "";
	for (const line of source.split("\n")) {
		if (line.startsWith("import ")) continue;
		if (line.startsWith("export function Check(")) continue;
		if (line.includes("External") || line.startsWith("export function SetExternal")) continue;
		if (line.trim().length === 0) continue;
		// 生成器给每条语句前面都补一行 @ts-ignore，连着几条时只留一行
		if (line.trim() === "// @ts-ignore" && previous.trim() === "// @ts-ignore") continue;
		kept.push(line);
		previous = line;
	}
	// 末行若是给 Check 出口留的 @ts-ignore，也去掉：出口已经在我们的模板里
	while (kept.length > 0 && kept[kept.length - 1].trim() === "// @ts-ignore") {
		kept.pop();
	}
	const body = kept.join("\n");
	for (const word of FORBIDDEN) {
		if (body.includes(word)) {
			throw new Error(`${label}: 生成体里仍引用外部名字 ${word}，这条 Schema 不能进生成物`);
		}
	}
	return { entry, body };
}

/** 生成的判断体必须是合法 JS，并且对给定样本给出预期结果。 */
function assertRuns(label, body, entry, samples) {
	let factory;
	try {
		factory = new Function(`${body}\nreturn ${entry};`);
	} catch (error) {
		throw new Error(`${label}: 生成的判断体不是合法 JS：${error.message}`);
	}
	const check = factory();
	for (const [value, expected] of samples) {
		const actual = check(value);
		if (actual !== expected) {
			throw new Error(`${label}: 自检不通过，${JSON.stringify(value)} 期望 ${expected} 得到 ${actual}`);
		}
	}
}

/** 把判断体、入口与非空守卫拼成一个具名工厂加一个常量。 */
function emitBlock({ comment, fnName, body, entry, nonEmpty }) {
	const indented = body
		.split("\n")
		.map((line) => (line.length === 0 ? line : `\t${line}`))
		.join("\n");
	const guards = (nonEmpty ?? []).map(
		(field) => `\t\t\ttypeof source.${field} === "string" && source.${field}.length > 0`,
	);
	const tail =
		guards.length === 0
			? `\treturn ${entry};`
			: `\treturn (value: unknown): boolean => {\n\t\tif (!${entry}(value)) return false;\n\t\tconst source = value as Record<string, unknown>;\n\t\treturn (\n${guards.join(" &&\n")}\n\t\t);\n\t};`;
	return [
		"/**",
		` * ${comment}`,
		" *",
		" * 生成代码，不要手改；改 Schema 之后重新跑 `npm run gen:checks`。",
		" */",
		`function build${fnName}(): (value: unknown) => boolean {`,
		indented,
		tail,
		"}",
		"",
		`const check${fnName} = build${fnName}();`,
	].join("\n");
}

const blocks = [];
const requestLines = [];
const dispatchLines = [];

for (const [method, entry] of Object.entries(REQUEST_SCHEMAS)) {
	if (entry === undefined) continue;
	const fnName = `Request${method[0].toUpperCase()}${method.slice(1)}`;
	const compiled = compileEntry(`request:${method}`, entry.params);
	assertRuns(`request:${method}`, compiled.body, compiled.entry, []);
	blocks.push(
		emitBlock({
			comment: `${method} 的参数判断。`,
			fnName,
			body: compiled.body,
			entry: compiled.entry,
			nonEmpty: entry.nonEmpty,
		}),
	);
	requestLines.push(`\t"${method}": { auth: "${entry.auth}", check: check${fnName} },`);
}

for (const [type, entry] of Object.entries(DISPATCH_SCHEMAS)) {
	if (entry === undefined) continue;
	const base = type.replace(/[^a-zA-Z]+(.)/g, (_match, char) => char.toUpperCase());
	const fnName = `Dispatch${base[0].toUpperCase()}${base.slice(1)}`;
	const compiled = compileEntry(`dispatch:${type}`, entry.action);
	assertRuns(`dispatch:${type}`, compiled.body, compiled.entry, []);
	blocks.push(
		emitBlock({
			comment: `${type} 的动作判断。`,
			fnName,
			body: compiled.body,
			entry: compiled.entry,
		}),
	);
	dispatchLines.push(`\t"${type}": { auth: "${entry.auth}", check: check${fnName} },`);
}

const frameLines = [];
for (const [name, schema] of Object.entries(SERVER_FRAME_SCHEMAS)) {
	const fnName = `Frame${name[0].toUpperCase()}${name.slice(1)}`;
	const compiled = compileEntry(`frame:${name}`, schema);
	assertRuns(`frame:${name}`, compiled.body, compiled.entry, []);
	blocks.push(
		emitBlock({ comment: `${name} 的信封判断。`, fnName, body: compiled.body, entry: compiled.entry }),
	);
	frameLines.push(`	${name}: check${fnName} as (value: unknown) => value is ActionFrame,`);
}

const header = `/**
 * 权限档与参数校验，由 \`packages/protocol/scripts/gen-checks.mjs\` 生成。
 *
 * 不要手改这个文件：改 \`src/schema/contracts.ts\` 里的 Schema，再跑
 * \`npm run gen:checks -w @facet/protocol\`。生成物不引用 typebox，也不做任何运行时编译。
 */
import type { DispatchContract, RequestContract } from "../contract.ts";
import type { ActionFrame } from "../wire.ts";`;

const tables = [
	"/** 方法名到契约的表。查不到就是未知方法。 */",
	"export const REQUEST_CONTRACTS: Readonly<Record<string, RequestContract | undefined>> = {",
	...requestLines,
	"};",
	"",
	"/** 主机推送的帧信封；生成物带类型谓词，调用方拿到的就是对应类型。 */",
	"export const SERVER_FRAME_CONTRACTS = {",
	...frameLines,
	"} as const;",
	"",
	"/** 客户端可派发动作到契约的表。查不到就是主机内部事件，端点不得接受。 */",
	"export const DISPATCH_CONTRACTS: Readonly<Record<string, DispatchContract | undefined>> = {",
	...dispatchLines,
	"};",
].join("\n");

await mkdir(dirname(outFile), { recursive: true });
await writeFile(outFile, `${header}\n\n${blocks.join("\n\n")}\n\n${tables}\n`, "utf8");

if (!process.argv.includes("--skip-tsc")) {
	const result = spawnSync(
		process.execPath,
		[
			join(packageRoot, "../../node_modules/typescript/bin/tsc"),
			"-p",
			join(packageRoot, "tsconfig.json"),
			"--noEmit",
		],
		{ encoding: "utf8" },
	);
	if (result.status !== 0) {
		process.stderr.write(result.stdout ?? "");
		process.stderr.write(result.stderr ?? "");
		throw new Error("生成的 checks.ts 没通过类型检查");
	}
}

process.stdout.write(`generated ${outFile}: ${requestLines.length} 个方法，${dispatchLines.length} 个动作\n`);
