import "./style.css";
import { showMainMenu } from "./menu";

const app = document.getElementById("app")!;
showMainMenu(app);

// PWA: service worker gør spillet installerbart og offline-dygtigt
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + "sw.js").catch(() => {});
  });
}
