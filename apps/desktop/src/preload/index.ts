import { contextBridge } from "electron";

const api = {
	platform: process.platform,
};

contextBridge.exposeInMainWorld("facet", api);

export type FacetApi = typeof api;
