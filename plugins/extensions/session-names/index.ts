import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerAutoName } from "./auto-name.ts";

export default function sessionNames(pi: ExtensionAPI): void {
	registerAutoName(pi);
}
