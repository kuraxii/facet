#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const groups = ["apps", "packages", join("plugins", "extensions")];

/**
 * 不在工作区清单里的独立 TS 项目。
 *
 * `tools/` 下没有 package.json，假主机这类脚本不参与 npm workspaces，这里按各自的
 * tsconfig 单独检查，免得成为类型检查的盲区。
 */
const projects = [join("tools", "mock-server", "tsconfig.json")];

function collectWorkspaces() {
	const workspaces = [];
	for (const group of groups) {
		const groupDir = join(root, group);
		if (!existsSync(groupDir)) {
			continue;
		}
		for (const entry of readdirSync(groupDir)) {
			const manifestPath = join(groupDir, entry, "package.json");
			if (!existsSync(manifestPath)) {
				continue;
			}
			const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
			if (typeof manifest.name === "string" && typeof manifest.scripts?.typecheck === "string") {
				workspaces.push({ name: manifest.name, dir: join(groupDir, entry) });
			}
		}
	}
	return workspaces;
}

function runProject(project) {
	const tsc = join(root, "node_modules", "typescript", "bin", "tsc");
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [tsc, "--noEmit", "-p", join(root, project)], {
			cwd: root,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		child.on("close", (code) => {
			resolve({ name: project, code: code ?? 1, output });
		});
		child.on("error", (error) => {
			resolve({ name: project, code: 1, output: `${output}${error.message}\n` });
		});
	});
}

function runWorkspace(workspace) {
	return new Promise((resolve) => {
		// Windows 上 .cmd 不能直接 spawn：Node 20.12 起拒绝这种调用并报 EINVAL。经由同一个 Node
		// 跑 npm 的入口脚本即可绕开，`npm run typecheck` 一定给了 npm_execpath；直接执行本脚本时
		// 退回命令行脚本，此时才需要一层 shell
		const npmCli = process.env.npm_execpath;
		const command =
			npmCli === undefined ? (process.platform === "win32" ? "npm.cmd" : "npm") : process.execPath;
		const child = spawn(
			command,
			[
				...(npmCli === undefined ? [] : [npmCli]),
				"run",
				"--silent",
				"typecheck",
				"--workspace",
				workspace.name,
			],
			{
				cwd: root,
				stdio: ["ignore", "pipe", "pipe"],
				shell: npmCli === undefined && process.platform === "win32",
			},
		);
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		child.on("close", (code) => {
			resolve({ name: workspace.name, code: code ?? 1, output });
		});
		child.on("error", (error) => {
			resolve({ name: workspace.name, code: 1, output: `${output}${error.message}\n` });
		});
	});
}

const workspaces = collectWorkspaces();
const concurrency = Math.max(2, Math.min(4, availableParallelism()));
const queue = [...workspaces.map((workspace) => ({ kind: "workspace", workspace }))];
const failures = [];

async function worker() {
	for (;;) {
		const next = queue.shift();
		if (next === undefined) {
			return;
		}
		const result =
			next.kind === "workspace" ? await runWorkspace(next.workspace) : await runProject(next.project);
		if (result.code === 0) {
			process.stdout.write(`ok ${result.name}\n`);
			continue;
		}
		failures.push(result);
		process.stdout.write(`failed ${result.name}\n`);
	}
}

for (const project of projects) {
	queue.push({ kind: "project", project });
}

await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

if (failures.length > 0) {
	for (const failure of failures) {
		process.stderr.write(`\n${failure.name}\n${failure.output}`);
	}
	process.exitCode = 1;
} else {
	process.stdout.write(`${workspaces.length} workspaces + ${projects.length} projects passed\n`);
}
