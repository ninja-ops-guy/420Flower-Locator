import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swUrl = new URL("sw.js", document.baseURI).toString();
    navigator.serviceWorker.register(swUrl, { scope: "./" }).catch(() => {
      // The locator remains fully usable online if service-worker registration is unavailable.
    });
  });
}
