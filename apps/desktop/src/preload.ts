import { contextBridge } from "electron";

// Surface a tiny, safe API to the renderer. Grows as login / backend wiring lands.
contextBridge.exposeInMainWorld("stm", {
  version: "0.3.0",
});
