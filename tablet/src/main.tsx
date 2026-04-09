import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

// Register service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/tablet/sw.js").catch(() => {});
  });
}

createRoot(document.getElementById("root")!).render(<App />);
