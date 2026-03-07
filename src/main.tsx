import React from "react";
import ReactDOM from "react-dom/client";
import "./i18n";
import { initTheme } from "./components/SettingsDialog";
import App from "./App";
import "./App.css";

initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
