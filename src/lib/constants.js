import { Wallet, ListOrdered, LineChartIcon, Receipt, Coins, Target, Settings2 } from "./icons.jsx";

export const APP_VERSION = "4.7-personal-advisor-v2.30.0-gemini35";

export const BACKUP_SCHEMA_VERSION = 2;

export const TABS = [
  { id: "dashboard", label: "總覽", icon: Wallet },
  { id: "holdings", label: "持股進度", icon: ListOrdered },
  { id: "daily", label: "每日紀錄", icon: LineChartIcon },
  { id: "trades", label: "交易紀錄", icon: Receipt },
  { id: "dividends", label: "配息", icon: Coins },
  { id: "progress", label: "計畫進度", icon: Target },
  { id: "plan", label: "計畫設定", icon: Settings2 },
];

export const COLORS = {
  bg: "#0A0F1C",
  panel: "#111A2E",
  panelBorder: "#1E2A44",
  text: "#E9EEF7",
  sub: "#7C88A3",
  gain: "#EF4444",   // 台股慣例：紅漲
  loss: "#22C55E",   // 台股慣例：綠跌
  gold: "#C9A24B",
};

export const DAILY_SEED = [];

export const CHART_RANGES = [
  { id: "1m", label: "1個月", days: 30 },
  { id: "3m", label: "3個月", days: 90 },
  { id: "6m", label: "半年", days: 182 },
  { id: "1y", label: "1年", days: 365 },
  { id: "all", label: "全部", days: null },
];

export const DIVIDEND_CHART_COLORS = ["#6C93C7", "#4FB6A8", "#B77DC9", "#D98C63", "#8FBF6B", "#E0A9C5"];

export const READ_TOOL_NAMES = ["query_app_data", "get_live_quotes"];

// 每日紀錄單筆算出所有欄位（總資產/總本金/損益 + 台美股個別），query_app_data 的
// 每一種 daily_records 彙總方式都是拿這個函式的結果去加減比較，AI 完全不用自己算。
