import "./index.css";
import ReactDOM from "react-dom/client";
import AssetTracker from "./App.jsx";
import { LanguageProvider } from "./lib/i18n.jsx";

ReactDOM.createRoot(document.getElementById('root')).render(
  <LanguageProvider>
    <AssetTracker />
  </LanguageProvider>
);
