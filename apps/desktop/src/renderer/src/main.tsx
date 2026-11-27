import { createRoot } from "react-dom/client";
import "@facet/ui/styles";
// 先装浏览器里的桥，再加载界面：界面模块一加载就会读 window.facet
import "./web-bootstrap.ts";
import { App } from "./App";
import { applyAppearance } from "./hooks/useWorkspaceShell.ts";
import { applyLayoutBootstrap } from "./layout-mode.ts";
import { readLocalAppearance } from "./local-storage.ts";

const container = document.getElementById("root");
if (!container) throw new Error("root container missing");

// 首帧之前把布局档位与本机外观写到根节点：BootScreen 与工作区渲染前即已是用户主题
applyLayoutBootstrap();
applyAppearance(readLocalAppearance());

/*
 * 根节点不套 StrictMode。
 *
 * 开发态 StrictMode 会把整棵树挂载两遍，而这里的界面在第二遍之后就不再生效：按钮点不动，
 * 直接对状态调 dispatch 也进不了根队列，界面停在第一次提交的画面上（生产构建不受影响，
 * 关掉它只影响开发态）。等这棵树的双挂载问题查清再放回来。
 */
createRoot(container).render(<App />);
