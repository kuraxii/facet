#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const groups = ["apps", "packages", join("plugins", "extensions")];

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

function runWorkspace(workspace) {
	return new Promise((resolve) => {
		const command = process.platform === "win32" ? "npm.cmd" : "npm";
		const child = spawn(command, ["run", "--silent", "typecheck", "--workspace", workspace.name], {
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
			resolve({ workspace, code: code ?? 1, output });
		});
		child.on("error", (error) => {
			resolve({ workspace, code: 1, output: `${output}${error.message}\n` });
		});
	});
}

const workspaces = collectWorkspaces();
const concurrency = Math.max(2, Math.min(4, availableParallelism()));
const queue = [...workspaces];
const failures = [];

async function worker() {
	for (;;) {
		const workspace = queue.shift();
		if (workspace === undefined) {
			return;
		}
		const result = await runWorkspace(workspace);
		if (result.code === 0) {
			process.stdout.write(`ok ${workspace.name}\n`);
			continue;
		}
		failures.push(result);
		process.stdout.write(`failed ${workspace.name}\n`);
	}
}

await Promise.all(Array.from({ length: Math.min(concurrency, workspaces.length) }, worker));

if (failures.length > 0) {
	for (const failure of failures) {
		process.stderr.write(`\n${failure.workspace.name}\n${failure.output}`);
	}
	process.exitCode = 1;
} else {
	process.stdout.write(`${workspaces.length} workspaces passed\n`);
}
