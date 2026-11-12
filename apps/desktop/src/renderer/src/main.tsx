import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@facet/ui/styles";
// 先装浏览器里的桥，再加载界面：界面模块一加载就会读 window.facet
import "./web-bootstrap.ts";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("root container missing");

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
