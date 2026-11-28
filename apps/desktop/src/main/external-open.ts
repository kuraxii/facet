/**
 * 桌面主进程外部打开通道：支持通过 VS Code（协议 URI 优先，CLI 兜底）或系统文件管理器打开本地文件/目录。
 */
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { ipcMain, shell } from "electron";

/** 构造 `vscode://file/...` 协议地址（保留盘符冒号与正斜杠，转义空格与 `#`/`?`）。 */
export function buildVsCodeFileUri(targetPath: string): string {
	const normalized = resolve(targetPath).replace(/\\/g, "/");
	const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
	const encoded = encodeURI(withLeadingSlash).replace(/#/g, "%23").replace(/\?/g, "%3F");
	return `vscode://file${encoded}`;
}

/** 用 VS Code 打开指定文件或目录；协议拉起失败时尝试 CLI `code`。 */
export async function openInVsCode(targetPath: string): Promise<void> {
	const uri = buildVsCodeFileUri(targetPath);
	try {
		await shell.openExternal(uri);
		return;
	} catch {
		// 协议未注册时降级到 PATH 上的 `code` 命令
	}
	await new Promise<void>((resolveDone, reject) => {
		const child = spawn("code", [resolve(targetPath)], {
			detached: true,
			stdio: "ignore",
			windowsHide: true,
		});
		child.once("error", (error) => reject(error));
		child.once("spawn", () => {
			child.unref();
			resolveDone();
		});
	});
}

/** 在系统文件管理器中显示文件（若是目录则直接打开该目录）。 */
export async function revealInSystemFileManager(targetPath: string): Promise<void> {
	const resolved = resolve(targetPath);
	try {
		const info = await stat(resolved);
		if (info.isDirectory()) {
			const error = await shell.openPath(resolved);
			if (error.length > 0) {
				throw new Error(error);
			}
			return;
		}
	} catch {
		// stat 失败时交给 showItemInFolder 尝试定位父目录
	}
	shell.showItemInFolder(resolved);
}

/** 注册桌面端外部打开文件/目录的 IPC 处理器。 */
export function registerExternalOpenIpc(): void {
	ipcMain.handle("facet:external-open-vscode", async (_event, targetPath: unknown) => {
		if (typeof targetPath !== "string" || targetPath.length === 0) {
			return;
		}
		await openInVsCode(targetPath);
	});
	ipcMain.handle("facet:external-open-reveal", async (_event, targetPath: unknown) => {
		if (typeof targetPath !== "string" || targetPath.length === 0) {
			return;
		}
		await revealInSystemFileManager(targetPath);
	});
}
