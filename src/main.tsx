import React from "react";
import ReactDOM from "react-dom/client";
import { AuthRoot } from "./components/auth";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AuthRoot />
  </React.StrictMode>,
);
