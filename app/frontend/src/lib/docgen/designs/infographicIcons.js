// C28 (REQ-571): the icon set of the infographics. Lucide icon node arrays are imported (no runtime fetch, no new dependency) and drawn inline as <path> data.
// iconFor(text, k) picks one by the words of a step or outcome (industry-agnostic), glyph() draws it.
import { __iconNode as Database } from 'lucide-react/dist/esm/icons/database.js';
import { __iconNode as ChartLine } from 'lucide-react/dist/esm/icons/chart-line.js';
import { __iconNode as ChartColumn } from 'lucide-react/dist/esm/icons/chart-column.js';
import { __iconNode as Brain } from 'lucide-react/dist/esm/icons/brain.js';
import { __iconNode as CalendarClock } from 'lucide-react/dist/esm/icons/calendar-clock.js';
import { __iconNode as ClipboardCheck } from 'lucide-react/dist/esm/icons/clipboard-check.js';
import { __iconNode as ShieldCheck } from 'lucide-react/dist/esm/icons/shield-check.js';
import { __iconNode as HandCoins } from 'lucide-react/dist/esm/icons/hand-coins.js';
import { __iconNode as Wallet } from 'lucide-react/dist/esm/icons/wallet.js';
import { __iconNode as Users } from 'lucide-react/dist/esm/icons/users.js';
import { __iconNode as BellRing } from 'lucide-react/dist/esm/icons/bell-ring.js';
import { __iconNode as TriangleAlert } from 'lucide-react/dist/esm/icons/triangle-alert.js';
import { __iconNode as Workflow } from 'lucide-react/dist/esm/icons/workflow.js';
import { __iconNode as Cog } from 'lucide-react/dist/esm/icons/cog.js';
import { __iconNode as Truck } from 'lucide-react/dist/esm/icons/truck.js';
import { __iconNode as Boxes } from 'lucide-react/dist/esm/icons/boxes.js';
import { __iconNode as ScanSearch } from 'lucide-react/dist/esm/icons/scan-search.js';
import { __iconNode as Lightbulb } from 'lucide-react/dist/esm/icons/lightbulb.js';
import { __iconNode as Rocket } from 'lucide-react/dist/esm/icons/rocket.js';
import { __iconNode as TrendingUp } from 'lucide-react/dist/esm/icons/trending-up.js';
import { __iconNode as TrendingDown } from 'lucide-react/dist/esm/icons/trending-down.js';
import { __iconNode as Flag } from 'lucide-react/dist/esm/icons/flag.js';
import { __iconNode as Zap } from 'lucide-react/dist/esm/icons/zap.js';
import { __iconNode as Network } from 'lucide-react/dist/esm/icons/network.js';
import { __iconNode as ListChecks } from 'lucide-react/dist/esm/icons/list-checks.js';
import { __iconNode as Sparkles } from 'lucide-react/dist/esm/icons/sparkles.js';
import { __iconNode as Layers } from 'lucide-react/dist/esm/icons/layers.js';
import { __iconNode as Gauge } from 'lucide-react/dist/esm/icons/gauge.js';
import { __iconNode as Compass } from 'lucide-react/dist/esm/icons/compass.js';
import { __iconNode as Store } from 'lucide-react/dist/esm/icons/store.js';
import { __iconNode as HeartPulse } from 'lucide-react/dist/esm/icons/heart-pulse.js';
import { __iconNode as Leaf } from 'lucide-react/dist/esm/icons/leaf.js';
import { __iconNode as FileText } from 'lucide-react/dist/esm/icons/file-text.js';
import { __iconNode as Eye } from 'lucide-react/dist/esm/icons/eye.js';
import { __iconNode as Megaphone } from 'lucide-react/dist/esm/icons/megaphone.js';
import { __iconNode as Handshake } from 'lucide-react/dist/esm/icons/handshake.js';
import { __iconNode as Scale } from 'lucide-react/dist/esm/icons/scale.js';
import { __iconNode as ChartPie } from 'lucide-react/dist/esm/icons/chart-pie.js';

export const ICON_SET = {'database': Database, 'chart-line': ChartLine, 'chart-column': ChartColumn, 'brain': Brain, 'calendar-clock': CalendarClock, 'clipboard-check': ClipboardCheck, 'shield-check': ShieldCheck, 'hand-coins': HandCoins, 'wallet': Wallet, 'users': Users, 'bell-ring': BellRing, 'triangle-alert': TriangleAlert, 'workflow': Workflow, 'cog': Cog, 'truck': Truck, 'boxes': Boxes, 'scan-search': ScanSearch, 'lightbulb': Lightbulb, 'rocket': Rocket, 'trending-up': TrendingUp, 'trending-down': TrendingDown, 'flag': Flag, 'zap': Zap, 'network': Network, 'list-checks': ListChecks, 'sparkles': Sparkles, 'layers': Layers, 'gauge': Gauge, 'compass': Compass, 'store': Store, 'heart-pulse': HeartPulse, 'leaf': Leaf, 'file-text': FileText, 'eye': Eye, 'megaphone': Megaphone, 'handshake': Handshake, 'scale': Scale, 'chart-pie': ChartPie};
export const ICON_NAMES = Object.keys(ICON_SET);
const RULES = [
  [/forecast|predict|trend|time.?series|demand|projection/i, 'chart-line'],
  [/model|train|learn|neural|machine|\bai\b|intelligen|classif|cluster/i, 'brain'],
  [/alert|notif|anomal|warn|incident|monitor/i, 'bell-ring'],
  [/risk|fraud|threat|churn|deviation|breach/i, 'triangle-alert'],
  [/compliance|govern|secur|privacy|trust|polic|regulat/i, 'shield-check'],
  [/review|approv|validat|audit|verify|check|quality|accuracy/i, 'clipboard-check'],
  [/plan|schedul|roadmap|calendar|timeline|cadence|phase/i, 'calendar-clock'],
  [/saving|revenue|value|profit|price|pricing|margin|income|\$|usd|cash/i, 'hand-coins'],
  [/cost|budget|financ|spend|invoice|payment|expense/i, 'wallet'],
  [/customer|people|team|staff|user|segment|audience|employee|member|patient|guest|client/i, 'users'],
  [/dashboard|report|kpi|metric|insight|analy|visuali|measure|score/i, 'chart-column'],
  [/logistic|deliver|ship|fleet|transport|route|dispatch/i, 'truck'],
  [/inventory|stock|supply|warehouse|product|package|assort/i, 'boxes'],
  [/automat|workflow|orchestrat|pipeline|process/i, 'workflow'],
  [/optimi|efficien|operation|maintenance|tune|improv/i, 'cog'],
  [/search|find|discover|explor|scan|identif|detect|locate/i, 'scan-search'],
  [/recommend|suggest|idea|opportunit|decision|decide|next best/i, 'lightbulb'],
  [/launch|grow|expand|boost|increase|scale up|accelerat/i, 'rocket'],
  [/reduc|waste|lower|decrease|cut|less|minimi/i, 'trending-down'],
  [/real.?time|fast|speed|latency|instant|hour|minute|quick/i, 'zap'],
  [/connect|integrat|network|join|share|sync/i, 'network'],
  [/goal|priorit|target|focus|objective|outcome/i, 'flag'],
  [/data|table|record|collect|ingest|source|lake|metadata|capture|gather|storage/i, 'database'],
  [/health|care|wellness|clinic/i, 'heart-pulse'],
  [/energy|sustain|carbon|green|climate/i, 'leaf'],
  [/market|campaign|brand|promo|engag/i, 'megaphone'],
  [/partner|agree|contract|negotiat/i, 'handshake'],
  [/store|retail|shop|branch|outlet/i, 'store'],
];
const SPARE = ['sparkles', 'layers', 'gauge', 'compass', 'zap', 'list-checks', 'eye', 'file-text', 'chart-pie', 'scale'];
// The icon for a text; the k-th spare icon when no word matches, so neighbouring cards differ.
export function iconFor(text, k = 0, used = null, more = '') {
  const byRule = (s) => RULES.filter(([re]) => re.test(String(s || ''))).map(([, n]) => n);
  const hits = [...byRule(text), ...byRule(more)]; // the title decides first, the explaining text second
  const pick = (hits.find((n) => !used || !used.has(n)) || (used && used.size < SPARE.length ? SPARE.find((n) => !used.has(n)) : null)) || hits[0] || SPARE[k % SPARE.length];
  if (used) used.add(pick);
  return pick;
}
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
// A 24x24 lucide icon centred at (cx, cy) with size s and stroke colour col, as an inline group. A <rect> or <circle> child stays; the <path> children carry the shape.
export function glyph(name, cx, cy, s, col, sw = 2) {
  const nodes = ICON_SET[name] || ICON_SET.sparkles;
  const body = nodes.map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return `<g data-role="icon" data-icon="${name}" transform="translate(${(cx - s / 2).toFixed(1)} ${(cy - s / 2).toFixed(1)}) scale(${(s / 24).toFixed(4)})" fill="none" stroke="${col}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}
