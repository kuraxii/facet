import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";

const isDev = !app.isPackaged;

function createWindow(): BrowserWindow {
	const window = new BrowserWindow({
		width: 1100,
		height: 760,
		minWidth: 640,
		minHeight: 480,
		show: false,
		autoHideMenuBar: true,
		backgroundColor: "#0c0c0d",
		title: "facet",
		webPreferences: {
			preload: join(app.getAppPath(), "out/preload/index.cjs"),
			contextIsolation: true,
			sandbox: true,
		},
	});

	window.once("ready-to-show", () => {
		window.show();
	});

	window.webContents.setWindowOpenHandler(({ url }) => {
		void shell.openExternal(url);
		return { action: "deny" };
	});

	const rendererUrl = process.env.ELECTRON_RENDERER_URL;
	if (isDev && rendererUrl) {
		void window.loadURL(rendererUrl);
	} else {
		void window.loadFile("out/renderer/index.html");
	}

	return window;
}

app.whenReady().then(() => {
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") app.quit();
});
