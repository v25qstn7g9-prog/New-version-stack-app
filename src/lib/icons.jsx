import * as LR from "lucide-react";

export const FallbackIcon = ({ size = 20, ...props }) => (
  <span {...props} style={{ display:"inline-block", width:size, height:size, lineHeight:`${size}px`, textAlign:"center", ...(props.style||{}) }}>•</span>
);

export const TrendingUp = LR.TrendingUp || FallbackIcon;

export const TrendingDown = LR.TrendingDown || FallbackIcon;

export const Plus = LR.Plus || FallbackIcon;

export const Trash2 = LR.Trash2 || FallbackIcon;

export const Wallet = LR.Wallet || FallbackIcon;

export const LineChartIcon = LR.LineChart || FallbackIcon;

export const ListOrdered = LR.ListOrdered || FallbackIcon;

export const Receipt = LR.Receipt || FallbackIcon;

export const Coins = LR.Coins || FallbackIcon;

export const Settings2 = LR.Settings2 || FallbackIcon;

export const X = LR.X || FallbackIcon;

export const Loader2 = LR.Loader2 || FallbackIcon;

export const Target = LR.Target || FallbackIcon;

export const Download = LR.Download || FallbackIcon;

export const Upload = LR.Upload || FallbackIcon;

export const ShieldCheck = LR.ShieldCheck || FallbackIcon;

export const ChevronLeft = LR.ChevronLeft || FallbackIcon;

export const ChevronRight = LR.ChevronRight || FallbackIcon;

export const ExternalLink = LR.ExternalLink || FallbackIcon;

export const Newspaper = LR.Newspaper || FallbackIcon;

export const MessageCircle = LR.MessageCircle || FallbackIcon;

export const Send = LR.Send || FallbackIcon;

// Drawn inline instead of pulled from the lucide-react CDN, specifically for
// edit/delete controls — if that CDN ever fails to load, every icon above
// silently falls back to a plain "•", which is confusing for actions as
// important as "delete this". These always render correctly regardless.

export const TrashIcon = ({ size = 15, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M3 6h18" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

export const PencilIcon = ({ size = 15, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
  </svg>
);

// ---------- constants ----------
