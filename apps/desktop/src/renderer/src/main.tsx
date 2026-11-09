import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@facet/ui/styles";
import { App } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("root container missing");

createRoot(container).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
