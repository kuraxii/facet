import "./terminal.css";

export type { DockStorage, TerminalDockState } from "./dock-state.ts";
export {
	clampDockHeight,
	DEFAULT_DOCK_STATE,
	DOCK_DEFAULT_HEIGHT,
	DOCK_MAX_RATIO,
	DOCK_MIN_HEIGHT,
	readDockState,
	writeDockState,
} from "./dock-state.ts";
export type { TerminalDockProps } from "./terminal-dock.tsx";
export { TerminalDock } from "./terminal-dock.tsx";
export type { TerminalAppearance, TerminalViewProps } from "./terminal-view.tsx";
export { TerminalView } from "./terminal-view.tsx";
