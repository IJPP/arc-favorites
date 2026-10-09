import { render } from "preact";
import { getLocale } from "../core/i18n";
import { App } from "./App";
import "./styles.css";

document.documentElement.lang = getLocale() === "zh" ? "zh-CN" : "en";
render(<App />, document.getElementById("app")!);
