// C25 (REQ-559 part 1): the PDF is the agent's catalog PDF (6a7361a39, _catalog_pdf_html and _PDF_CSS) plus value.
// Same sections in the same order, the same use case card with every label, each use case's value on its card, and one value page
// after the last domain's cards and before the index. The pages are cut here (a deterministic height model stands in for the paged
// media the agent had), each page is an A4 SVG holding XHTML, and the browser draws them to PNG for jsPDF.
import {
  buildAgentModel, agentOutline, DOC_COLORS, DOC_BRAND, DOC_QUALITY_ORDER, DOC_INDEX_COLUMNS, DOC_VALUE_LEFT,
  qualityColor, docJoin,
} from './agentModel.js';
import { chartTypesFor, ucChartSvg, portfolioChartSvg } from './designs/ucCharts.js';
import { execSummaryParas, purposeParas, domainsListOf } from './storyParts.js';

// The agent's _PDF_CSS (6a7361a39) without the @page rules, which the page box below replaces; html is the page root .ap.
const AGENT_PDF_CSS = `
* { box-sizing: border-box; }
.ap { font-family: __BODY__; color: #__C_ink__; font-size: __F_body__; line-height: 1.5; }

* { border-spacing: 0; }
h1, h2, h3, h4, h5 { font-family: __DISPLAY__; font-weight: 700; line-height: 1.16; margin: 0; }
p { margin: 0 0 7px; }
.txt, p, li, .v, .chip, td { overflow-wrap: break-word; hyphens: auto; }
a { color: #__C_teal__; text-decoration: none; }
.runbrand { position: running(brand); }
.mark { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #__C_gold__; margin-__E__: 6px; vertical-align: 0; }
.wordmark { font-family: __BODY__; font-size: __F_label__; color: #__C_muted__; letter-spacing: .3px; white-space: nowrap; }
.wordmark b { color: #__C_teal__; font-weight: 700; }
.wordmark.light { color: #__C_mint2__; }
.wordmark.light b { color: #__C_white__; }
.wordmark.big { font-size: __F_lead__; }
.sheet { break-before: page; page: plain; }
.sheet.sand { page: sand; }
.cards { page: plain; }
.eyebrow { color: #__C_coral__; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; font-size: __F_label__; }
.title { font-size: __F_title__; margin: 5px 0 0; }
.rule { height: 3px; width: 54px; background: #__C_gold__; margin: 9px 0 13px; border-radius: 2px; }
.eyebrow.pillb { display: inline-block; color: #__C_white__; border-radius: 20px; padding: 3px 12px; letter-spacing: 1.6px; }
.rule.wide { width: 140px; height: 5px; border-radius: 3px; }
.ucharts { display: flex; justify-content: space-between; margin: 2px 0 12px; }
.ucharts svg, .pcharts svg { display: block; flex: none; height: auto; max-width: 100%; }
.ucharts svg:not(:only-child), .pcharts svg:not(:only-child) { width: calc(50% - 7px); }
.pcharts svg:only-child { width: 100%; }
.pcharts { display: flex; justify-content: space-between; margin: 4px 0 14px; }
.dlrow { display: flex; align-items: center; gap: 12px; padding: 7px 10px; border-radius: 10px; margin-bottom: 5px; background: #__C_sand__; }
.dlrow .sw { flex: none; width: 10px; align-self: stretch; border-radius: 5px; }
.dlrow .dn { flex: 0 0 150px; font-weight: 700; font-size: __F_body__; color: #__C_ink__; }
.dlrow .dd { flex: 1; font-size: __F_small__; color: #__C_body__; line-height: 1.4; }
.dlrow .dk { flex: 0 0 64px; white-space: nowrap; text-align: center; font-size: __F_label__; color: #__C_muted__; line-height: 1.25; }
.dlrow .dk b { display: block; font-family: __DISPLAY__; font-size: __F_heading__; color: #__C_teal__; }
.purp p { font-size: __F_lead__; line-height: 1.6; }
.purp p.first::first-line { font-weight: 700; }
.lead { font-size: __F_lead__; color: #__C_body__; margin-bottom: 12px; }
.grid2 { display: table; width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 12px 0; margin-left: -12px; margin-right: -12px; }
.grid2 > * { display: table-cell; vertical-align: top; }
.grid2.gap { margin-top: 13px; }
.gap { margin-top: 13px; }
.card { background: #__C_white__; border: 1px solid #__C_line__; border-radius: 14px; padding: 12px 14px; break-inside: avoid; }
.card.soft { background: #__C_sand__; }
.sheet.sand .card.soft { background: #__C_sand2__; border-color: #__C_line__; }
.card h4 { font-size: __F_heading__; margin-bottom: 6px; color: #__C_ink__; }
.card p { font-size: __F_body__; }
.muted { color: #__C_muted__; }
table.stats { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 8px 0; margin-left: -8px; margin-right: -8px; }
table.stats td { background: #__C_sand__; border-radius: 11px; padding: 8px 6px; text-align: center; vertical-align: middle; }
.sheet.sand table.stats td { background: #__C_white__; border: 1px solid #__C_line__; }
table.stats .v { font-family: __DISPLAY__; font-size: __F_heading__; font-weight: 700; color: #__C_teal__; line-height: 1.15; hyphens: manual; }
table.stats .l { font-size: __F_label__; color: #__C_muted__; margin-top: 2px; line-height: 1.25; }
table.stats.big .v { font-size: __F_title__; }
.pill { display: inline-block; padding: 1px 8px; border-radius: 20px; font-size: __F_label__; font-weight: 700; color: #__C_white__; white-space: nowrap; }
.chips { margin-top: 2px; }
.chip { display: inline-block; background: #__C_sand2__; border-radius: 7px; padding: 2px 8px; margin: 0 0 4px; margin-__E__: 4px; font-size: __F_small__; color: #__C_teal__; }
.chip b { color: #__C_ink__; }
.cover { page: cover; position: relative; height: 297mm; padding: 17mm 17mm; color: #__C_white__; overflow: hidden;
  background: linear-gradient(150deg, #__C_teal_dark__ 0%, #__C_teal__ 46%, #__C_teal_mid__ 100%); }
.cover .art { position: absolute; top: 0; __E__: 0; width: 150mm; height: 150mm; }
.cover .net { position: absolute; bottom: 0; left: 0; width: 210mm; height: 70mm; }
.cover .inner { position: relative; }
.cover .kick { letter-spacing: 3px; text-transform: uppercase; font-size: __F_label__; font-weight: 700; color: #__C_mint2__; margin-top: 16mm; }
.cover h1 { font-size: __F_hero__; color: #__C_white__; margin: 13px 0 0; max-width: 146mm; }
.cover .for { font-size: __F_lead__; color: #__C_mint2__; margin-top: 20px; }
.cover .biz { font-family: __DISPLAY__; font-size: __F_display__; color: #__C_gold__; font-weight: 700; margin-top: 2px; }
.cover .modepill { display: inline-block; margin-top: 14px; background: #__C_gold__; color: #__C_gold_ink__; border-radius: 20px; padding: 4px 13px; font-weight: 700; font-size: __F_small__; }
.cover table.glass { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 11px 0; margin: 22px -11px 0; }
.cover table.glass td { background: rgba(255,255,255,.10); border: 1px solid rgba(255,255,255,.26); border-radius: 14px; padding: 12px 14px; vertical-align: top; }
.cover .glass .v { font-family: __DISPLAY__; font-size: __F_display__; color: #__C_white__; font-weight: 700; line-height: 1.1; }
.cover .glass .l { font-size: __F_small__; color: #__C_mint3__; margin-top: 3px; }
.cover .foot { position: absolute; left: 17mm; right: 17mm; bottom: 74mm; border-top: 1px solid rgba(255,255,255,.26); padding-top: 11px; }
.cover .foot .meta { font-size: __F_small__; color: #__C_mint2__; margin-top: 4px; }
.toc { display: table; width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 12px 10px; margin: -10px -12px 0; }
.toc .tr { display: table-row; }
.toc .it { display: table-cell; background: #__C_sand__; border-radius: 14px; padding: 12px 14px; vertical-align: top; }
.toc .n { display: inline-block; width: 30px; height: 30px; border-radius: 9px; color: #__C_white__; text-align: center; line-height: 30px; font-family: __DISPLAY__; font-weight: 700; font-size: __F_body__; margin-__E__: 10px; vertical-align: top; }
.toc .tx { display: inline-block; width: 68%; vertical-align: top; }
.toc .t { font-weight: 700; font-size: __F_lead__; color: #__C_ink__; }
.toc .s { font-size: __F_small__; color: #__C_muted__; margin-top: 2px; }
.toc .pgn { display: inline-block; width: 12%; text-align: __E__; vertical-align: top; font-weight: 700; color: #__C_teal__; font-size: __F_body__; }
.exec p { font-size: __F_lead__; line-height: 1.62; color: #__C_body2__; margin-bottom: 9px; }
.exec p.first { color: #__C_ink__; }
.legend span { display: inline-block; margin: 0 10px 4px 0; font-size: __F_small__; color: #__C_muted__; }
.dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-__E__: 4px; vertical-align: -1px; }
.scale { height: 12px; border-radius: 6px; background: linear-gradient(__GDIR__, #__C_coral__, #__C_amber__ 40%, #__C_green__ 70%, #__C_teal_dark__); margin: 8px 0 3px; }
.scale-l { display: table; width: 100%; font-size: __F_small__; color: #__C_muted__; }
.scale-l span { display: table-cell; }
.scale-l span:nth-child(2) { text-align: center; }
.scale-l span:last-child { text-align: __E__; }
.modes .mrow { padding: 6px 0; border-bottom: 1px solid #__C_line__; font-size: __F_body__; }
.modes .mrow:last-child { border-bottom: none; }
.modes .mrow b { color: #__C_teal__; }
.modes .mrow.on { background: #__C_white__; border-radius: 9px; padding: 6px 8px; border: 1px solid #__C_gold__; }
.tag { display: inline-block; background: #__C_gold__; color: #__C_gold_ink__; border-radius: 6px; padding: 0 6px; font-size: __F_label__; font-weight: 700; margin-__S__: 6px; }
table.bars { width: 100%; border-collapse: collapse; font-size: __F_small__; }
table.bars td { padding: 3px 4px; border-bottom: 1px solid #__C_sand2__; vertical-align: middle; }
table.bars tr:last-child td { border-bottom: none; }
table.bars td.nm { width: 36%; }
table.bars td.n { width: 8%; text-align: center; font-weight: 700; color: #__C_teal__; }
table.bars a { color: #__C_ink__; font-weight: 600; }
.track { height: 9px; background: #__C_sand2__; border-radius: 5px; overflow: hidden; }
.fill { height: 9px; border-radius: 5px; background: linear-gradient(__GDIR__, #__C_teal__, #__C_teal_mid__); }
.stack { display: table; width: 100%; table-layout: fixed; height: 16px; border-radius: 8px; overflow: hidden; margin: 6px 0 10px; }
.stack span { display: table-cell; height: 16px; }
table.qrows { width: 100%; border-collapse: collapse; font-size: __F_small__; }
table.qrows td { padding: 3px 0; border-bottom: 1px solid #__C_sand2__; }
table.qrows tr:last-child td { border-bottom: none; }
table.qrows td.n { text-align: __E__; font-weight: 700; }
table.index { width: 100%; border-collapse: collapse; font-size: __F_small__; table-layout: fixed; }
table.index thead { display: table-header-group; }
table.index th { background: #__C_teal__; color: #__C_white__; padding: 5px 6px; text-align: __S__; font-weight: 600; font-size: __F_label__; }
table.index td { padding: 4px 6px; border-bottom: 1px solid #__C_line__; vertical-align: middle; }
table.index tr { break-inside: avoid; }
table.index tbody tr:nth-child(even) td { background: #__C_sand3__; }
table.index td.ix-rank { font-family: __DISPLAY__; font-weight: 700; color: #__C_teal__; text-align: center; }
table.index td.ix-id a { color: #__C_coral__; font-weight: 700; }
table.index td.ix-id { white-space: nowrap; }
table.index td.ix-title a { color: #__C_ink__; }
table.index .ixflag { display: inline-block; background: #__C_note__; color: #__C_note_ink__; border-radius: 6px; padding: 0 5px; font-size: __F_label__; font-weight: 700; margin-__E__: 4px; }
table.index td.ix-quality, table.index td.ix-inspire_score { text-align: center; }
table.index td.ix-inspire_score { white-space: nowrap; font-weight: 700; color: #__C_teal__; }
.opener { page: opener; break-before: page; }
.opener .band { position: relative; overflow: hidden; color: #__C_white__; margin: -19mm -15mm 0; padding: 12mm 15mm 11mm;
  background: linear-gradient(150deg, #__C_teal_dark__ 0%, #__C_teal__ 50%, #__C_teal_mid__ 100%); }
.opener .band .art { position: absolute; top: -6mm; __E__: -6mm; width: 96mm; height: 96mm; }
.opener .band .in { position: relative; }
.opener .band .wordmark { display: block; margin-bottom: 6mm; }
.opener .num { font-family: __DISPLAY__; font-size: __F_numeral__; line-height: .92; color: rgba(255,255,255,.2); font-weight: 700; }
.opener .band .eyebrow { color: #__C_coral_soft__; margin-top: 2px; }
.opener h2 { font-size: __F_display__; color: #__C_white__; margin-top: 3px; }
.opener .band .sub { color: #__C_mint3__; font-size: __F_body__; margin-top: 7px; max-width: 170mm; }
.opener .body { padding: 7mm 0 4mm; }
.opener .cols { display: table; width: 100%; table-layout: fixed; }
.opener .cols > * { display: table-cell; vertical-align: top; }
.opener .cols > :first-child { width: 57%; padding-__E__: 14px; }
.opener .overview p { font-size: __F_body__; line-height: 1.6; color: #__C_body2__; }
.opener .overview p.first { font-size: __F_lead__; color: #__C_ink__; }
.opener h4 { font-size: __F_heading__; margin-bottom: 7px; }
.uc { break-inside: avoid; border: 1px solid #__C_line__; border-radius: 14px; padding: 11px 14px; margin: 0 0 10px; background: #__C_white__; }
.uc .main { break-inside: avoid; }
.uc .head { display: table; width: 100%; }
.uc .head > * { display: table-cell; vertical-align: top; }
.uc .badge { width: 40px; height: 40px; border-radius: 11px; background: #__C_teal__; color: #__C_white__; font-family: __DISPLAY__; font-weight: 700; font-size: __F_heading__; text-align: center; vertical-align: middle; }
.uc .badge.elite { background: #__C_gold__; color: #__C_gold_ink__; }
.uc .badge.coverage { background: #__C_coral__; }
.uc .hd { padding-__S__: 12px; }
.uc .kick { color: #__C_coral__; font-weight: 700; font-size: __F_label__; letter-spacing: 1.2px; text-transform: uppercase; }
.uc h3 { font-size: __F_heading__; margin-top: 2px; color: #__C_ink__; }
.uc .sub { color: #__C_muted__; font-size: __F_small__; margin-top: 2px; }
.uc .band { height: 5px; border-radius: 3px; margin: 7px 0; background: linear-gradient(__GDIR__, #__C_teal__, #__C_teal_mid__ 62%, #__C_gold__); }
.uc table.stats { margin-bottom: 7px; border-spacing: 5px 0; margin-left: -5px; margin-right: -5px; }
.uc table.stats td { padding: 5px 4px; border-radius: 9px; }
.uc table.stats .v { font-size: __F_small__; }
.uc table.stats .l { font-size: __F_micro__; }
.uc .cols { display: table; width: 100%; table-layout: fixed; }
.uc .cols > * { display: table-cell; vertical-align: top; width: 50%; }
.uc .cols > :first-child { padding-__E__: 13px; }
.uc h5 { font-family: __BODY__; font-size: __F_label__; font-weight: 700; text-transform: uppercase; letter-spacing: .8px; color: #__C_teal__; margin: 0 0 2px; }
.uc .blk { margin-bottom: 6px; }
.uc .blk p { font-size: __F_body__; margin: 0; }
table.kv { border-collapse: collapse; width: 100%; font-size: __F_small__; margin-top: 2px; }
table.kv td { padding: 2px 0; vertical-align: top; border-bottom: 1px solid #__C_sand2__; }
table.kv tr:last-child td { border-bottom: none; }
table.kv td.k { color: #__C_teal__; font-weight: 700; width: 44%; padding-__E__: 9px; hyphens: manual; }
.uc .foot { text-align: __E__; margin-top: 5px; }
.btn { display: inline-block; background: #__C_night__; color: #__C_mint__; border-radius: 8px; padding: 4px 11px; font-size: __F_label__; font-weight: 700; }
.ribbon { background: #__C_note__; border: 1px solid #__C_note_line__; border-__S__: 3px solid #__C_coral__; border-radius: 9px; padding: 6px 10px; font-size: __F_small__; color: #__C_note_ink__; margin-bottom: 8px; }
.ribbon b { color: #__C_note_dark__; }
.ribbon.star { border-__S__-color: #__C_gold__; }
.ribbon.meets { background: #__C_ice__; border-color: #__C_mint2__; border-__S__-color: #__C_green__; color: #__C_teal_dark__; }
.ribbon.meets b { color: #__C_teal_dark__; }
.untr { font-size: __F_label__; color: #__C_muted__; font-style: italic; margin-bottom: 6px; }
.uc .val { display: table; width: 100%; table-layout: fixed; margin-top: 6px; padding-top: 6px; border-top: 1px solid #__C_sand2__; }
.uc .val > * { display: table-cell; vertical-align: top; width: 50%; }
.uc .val > :first-child { padding-__E__: 13px; }
.uc .blk ul { margin: 0; padding-__S__: 14px; font-size: __F_small__; }
.uc .blk li { margin: 0 0 2px; }
table.index td .jn { display: block; color: #__C_muted__; font-size: __F_label__; margin-top: 2px; }
table.found td { vertical-align: top; }
.steps { list-style: none; margin: 0; padding: 0; }
.steps li { position: relative; padding: 7px 0; padding-__S__: 36px; border-bottom: 1px solid #__C_line__; font-size: __F_body__; line-height: 1.4; }
.steps li:last-child { border-bottom: none; }
.steps li .k { position: absolute; __S__: 0; top: 6px; width: 24px; height: 24px; background: #__C_teal__; color: #__C_white__; border-radius: 50%; text-align: center; line-height: 24px; font-weight: 700; font-family: __DISPLAY__; font-size: __F_body__; }
.steps li b { color: #__C_ink__; }
.gloss .g { padding: 5px 0; border-bottom: 1px solid #__C_line__; font-size: __F_small__; }
.gloss .g:last-child { border-bottom: none; }
.gloss .g b { color: #__C_teal__; }
table.road { width: 100%; table-layout: fixed; border-collapse: separate; border-spacing: 10px 0; margin: 0 -10px; }
table.road td { background: #__C_sand__; border-radius: 14px; padding: 12px; vertical-align: top; border-top: 4px solid #__C_teal__; }
table.road .k { display: inline-block; width: 26px; height: 26px; border-radius: 50%; color: #__C_white__; text-align: center; line-height: 26px; font-weight: 700; font-family: __DISPLAY__; }
table.road h4 { font-size: __F_body__; margin: 8px 0 4px; }
table.road p { font-size: __F_small__; color: #__C_body__; margin: 0; }
.callout { background: #__C_ice__; border-__S__: 4px solid #__C_teal__; border-radius: 12px; padding: 12px 14px; font-size: __F_lead__; color: #__C_ink__; }
.disc .item { position: relative; padding: 11px 0; padding-__S__: 44px; border-bottom: 1px solid #__C_line__; font-size: __F_lead__; line-height: 1.55; color: #__C_body2__; }
.disc .item:last-child { border-bottom: none; }
.disc .item .k { position: absolute; __S__: 0; top: 10px; width: 30px; height: 30px; border-radius: 9px; background: #__C_teal__; color: #__C_white__; text-align: center; line-height: 30px; font-weight: 700; font-family: __DISPLAY__; }
.closing { page: closing; break-before: page; position: relative; height: 297mm; padding: 0 22mm; color: #__C_white__; overflow: hidden;
  background: linear-gradient(150deg, #__C_teal_dark__ 0%, #__C_teal__ 46%, #__C_teal_mid__ 100%); text-align: center; }
.closing .art { position: absolute; bottom: -10mm; __S__: -10mm; width: 130mm; height: 130mm; }
.closing .in { position: relative; padding-top: 80mm; }
.closing .kick { letter-spacing: 3px; text-transform: uppercase; font-size: __F_label__; font-weight: 700; color: #__C_mint2__; }
.closing h2 { font-size: __F_display__; color: #__C_white__; margin-top: 12px; }
.closing .gold { font-family: __DISPLAY__; font-size: __F_title__; color: #__C_gold__; font-weight: 700; margin-top: 4px; }
.closing .sum { font-size: __F_lead__; color: #__C_mint__; margin-top: 16px; }
.closing .wordmark { display: block; margin-top: 30px; }
.closing .meta { margin-top: 6px; font-size: __F_small__; color: #__C_mint2__; }
.ap.nocaps .eyebrow, .ap.nocaps .uc .kick, .ap.nocaps .uc h5, .ap.nocaps .elite .k, .ap.nocaps .cover .kick, .ap.nocaps .closing .kick { letter-spacing: 0; text-transform: none; }
.ap.rtl .cover .art, .ap.rtl .opener .band .art, .ap.rtl .closing .art { transform: scaleX(-1); }
.ap.rtl [dir="ltr"] { text-align: right; }
"""
`;

// The App's own lines: the page box that stands in for @page (header, footer, margins), and the value blocks C25 adds.
const PAGE_CSS = `
.ap { position: relative; width: 794px; height: 1123px; overflow: hidden; background: #__C_white__; margin: 0; }
.ap.sand { background: #__C_sand__; }
.ap.bleed { background: #__C_teal__; }
.ap > .content { position: absolute; top: 72px; left: 57px; width: 680px; height: 979px; }
.ap.bleed > .content { top: 0; left: 0; width: 794px; height: 1123px; }
.ap .hdr, .ap .ftr { position: absolute; left: 57px; right: 57px; display: flex; justify-content: space-between; font-size: __F_label__; }
.ap .hdr { top: 0; height: 57px; align-items: flex-end; color: #__C_muted__; }
.ap .ftr { top: 1070px; align-items: flex-start; color: #__C_grey__; }
.ap .ftr .pno { font-weight: 700; color: #__C_muted__; }
.uc.cont .kick { color: #__C_muted__; }
table.bars.vbars td.n { width: 24%; text-align: __E__; white-space: nowrap; }
table.bars.vbars td.nm { width: 34%; }
table.index td.ix-amount { white-space: nowrap; font-weight: 700; color: #__C_teal__; text-align: __E__; }
.vnote { font-size: __F_small__; color: #__C_muted__; margin-top: 8px; }
.story .kick { font-size: __F_label__; color: #__C_muted__; margin-bottom: 4px; }
.story .sum { display: table; width: 100%; table-layout: fixed; background: #__C_ice__; border-radius: 10px; border-__S__: 3px solid #__C_gold__; margin-bottom: 13px; }
.story .sum > * { display: table-cell; vertical-align: middle; padding: 8px 12px; }
.story .sum .amt { width: 34%; }
.story .sum .money { font-family: __DISPLAY__; font-size: __F_card_title__; font-weight: 700; color: #__C_teal_dark__; line-height: 1.15; }
.story .sum .why { font-size: __F_small__; color: #__C_body__; }
.story .sum .why b { color: #__C_teal__; }
.story .flist { font-size: __F_small__; color: #__C_body__; padding-__S__: 16px; }
.story .flist b { color: #__C_teal__; }
table.proj { width: 100%; border-collapse: collapse; font-size: __F_small__; }
table.proj th { text-align: __E__; padding: 3px 6px; color: #__C_muted__; font-size: __F_label__; border-bottom: 1px solid #__C_line__; }
table.proj td { text-align: __E__; padding: 4px 6px; border-bottom: 1px solid #__C_sand2__; white-space: nowrap; }
table.proj td:first-child, table.proj th:first-child { text-align: __S__; }
table.proj td.lk { font-weight: 700; color: #__C_teal__; }

.story .sum { display: flex; align-items: center; gap: 24px; background: #__C_ice__; border-radius: 14px; border-__S__: 5px solid #__C_gold__; padding: 18px 22px; margin-bottom: 14px; }
.story .sum > * { display: block; padding: 0; }
.story .sum .amt { flex: 0 0 38%; }
.story .sum .money { font-size: __F_hero__; line-height: 1.05; }
.story .sum .why { flex: 1; font-size: __F_small__; line-height: 1.45; }
.story .sum .why > div { margin-bottom: 6px; }
.story .sum h5, .story .lede h5 { font-family: __BODY__; font-size: __F_label__; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2px; color: #__C_teal__; margin: 0 0 6px; }
.story .lede { border-__S__: 4px solid #__C_teal__; padding: 4px 0 4px 20px; margin-bottom: 14px; }
.story .lede p { font-size: __F_lead__; line-height: 1.55; color: #__C_body2__; margin: 0 0 6px; }
.story.grow { flex: 1 1 auto; display: flex; flex-direction: column; margin-bottom: 14px; min-height: 250px; }
.story .pcard, .story .dcard { background: #__C_white__; border: 1px solid #__C_line__; border-radius: 14px; padding: 16px 22px; }
.story .pcard { flex: 1 1 auto; display: flex; flex-direction: column; background: #__C_sand__; border-color: #__C_sand2__; }
.story .dcard { margin-bottom: 0; }
.story h4 { font-size: __F_heading__; margin: 0; }
.story .phd { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.story .legend2 span { display: inline-block; margin-__S__: 14px; font-size: __F_small__; color: #__C_muted__; }
.story .sw { display: inline-block; width: 11px; height: 11px; border-radius: 3px; margin-__E__: 5px; vertical-align: -1px; }
.story .sw.low, .story .b.low { background: #__C_mint2__; }
.story .sw.likely, .story .b.likely { background: #__C_teal__; }
.story .sw.high, .story .b.high { background: #__C_gold__; }
.story .chart { flex: 1 1 auto; display: flex; gap: 22px; min-height: 150px; margin-bottom: 10px; }
.story .yg { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.story .plot { flex: 1; display: flex; align-items: stretch; justify-content: center; gap: 8px; border-bottom: 2px solid #__C_line__; }
.story .col { width: 30%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
.story .bv { font-size: __F_small__; font-weight: 700; color: #__C_ink__; margin-bottom: 4px; white-space: nowrap; }
.story .b { width: 100%; border-radius: 6px 6px 0 0; }
.story .yl { text-align: center; font-size: __F_small__; font-weight: 700; color: #__C_muted__; padding-top: 6px; }
.story table.proj { font-size: __F_small__; background: #__C_white__; border-radius: 10px; }
.story table.proj th { font-size: __F_label__; text-transform: uppercase; letter-spacing: .8px; padding: 7px 10px; }
.story table.proj td { padding: 7px 10px; }
.story table.proj tbody tr:nth-child(even) td { background: #__C_sand3__; }
.story .drv { margin-top: 14px; }
.story .dh { display: flex; justify-content: space-between; font-size: __F_body__; font-weight: 700; margin-bottom: 5px; }
.story .ds { color: #__C_teal__; }
.story .track { height: 12px; border-radius: 6px; }
.story .fill { height: 12px; border-radius: 6px; }
.story .df { font-size: __F_small__; color: #__C_body__; margin-top: 5px; line-height: 1.45; }
.fillcol > .story { flex-shrink: 0; }
.fillcol > .story.grow { flex-shrink: 1; }

.opener { height: 979px; display: flex; flex-direction: column; }
.opener .band { flex: none; margin-bottom: 0; padding: 14mm 15mm 10mm; }
.opener .band .art { width: 110mm; height: 110mm; }
.opener .num { font-size: __F_numeral__; }
.opener h2 { font-size: __F_display__; }
.opener .band .sub { font-size: __F_lead__; }
.opener .body { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; padding: 18px 0 0; }
.opener table.domstats { margin-top: 0; margin-bottom: 14px; border-spacing: 10px 0; margin-left: -10px; margin-right: -10px; width: calc(100% + 20px); }
.opener table.domstats td { padding: 14px 8px; border-radius: 14px; }
.opener table.domstats .v { font-size: 34px; line-height: 1.1; white-space: nowrap; }
.opener table.domstats .l { font-size: __F_small__; margin-top: 4px; }
.opener .orow { display: flex; gap: 28px; margin-bottom: 14px; }
.opener .orow .overview { flex: 1 1 0; }
.opener .orow .cov { flex: 0 0 38%; }
.opener .overview p { font-size: __F_body__; line-height: 1.55; margin-bottom: 6px; }
.opener .overview p.first { font-size: __F_lead__; }
.opener h4 { font-size: __F_heading__; margin-bottom: 7px; }
.opener .chip { font-size: __F_small__; padding: 4px 10px; margin-bottom: 6px; }
.opener h4.dch { margin: 4px 0 10px; }
.opener .dvs { flex: none; margin-top: 14px; padding: 14px 18px 8px; border: 1px solid #__C_sand2__; border-radius: 14px; background: #__C_white__; }
.opener .dvs h4 { margin-bottom: 8px; }
.opener .dvr { display: flex; align-items: center; gap: 12px; height: 26px; }
.opener .dvr .nm { flex: 0 0 30%; font-size: __F_small__; color: #__C_body__; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.opener .dvr .tr { flex: 1 1 0; height: 10px; border-radius: 5px; background: #__C_sand2__; overflow: hidden; }
.opener .dvr .tr i { display: block; height: 100%; background: #__C_teal_mid__; border-radius: 5px; opacity: .55; }
.opener .dvr .am { flex: 0 0 70px; text-align: __E__; font-size: __F_small__; color: #__C_body__; white-space: nowrap; }
.opener .dvr.me .nm, .opener .dvr.me .am { color: #__C_ink__; font-weight: 700; }
.opener .dvr.me .tr i { background: #__C_teal__; opacity: 1; }
.opener .dcs { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; gap: 8px; }
.opener.cont .dcs { margin-top: 4px; }
.dc { flex: 1 1 0; min-height: 58px; max-height: 230px; display: flex; align-items: center; gap: 16px; background: #__C_sand__; border: 1px solid #__C_sand2__; border-radius: 14px; padding: 8px 18px; }
.dc .rk { flex: none; width: 44px; height: 44px; line-height: 44px; border-radius: 12px; background: #__C_teal__; color: #__C_white__; text-align: center; font-family: __DISPLAY__; font-weight: 700; font-size: __F_heading__; }
.dc .rk.elite { background: #__C_gold__; color: #__C_gold_ink__; }
.dc .rk.coverage { background: #__C_coral__; }
.dc .dt { flex: 1; min-width: 0; }
.dc .dn { font-family: __DISPLAY__; font-weight: 700; font-size: __F_heading__; line-height: 1.2; color: #__C_ink__; }
.dc .dl { font-size: __F_small__; color: #__C_body__; margin-top: 3px; line-height: 1.4; }
.dc .dv { flex: none; text-align: __E__; min-width: 110px; }
.dc .dm { font-family: __DISPLAY__; font-weight: 700; font-size: __F_card_name__; color: #__C_teal_dark__; line-height: 1.1; margin-bottom: 4px; white-space: nowrap; }

/* C26 (REQ-563): the executive layout. A page is full, text is 11 px or more, and the card has a facts panel and the value at stake beside the story. */
.ap { line-height: 1.45; }
.fillcol { display: flex; flex-direction: column; height: 979px; }
.fillcol > * { flex-shrink: 0; }
.fillcol > .uc, .fillcol > .grow { flex: 1 1 auto; }
.uc { padding: 16px 22px; border-radius: 16px; margin: 0 0 14px; display: flex; flex-direction: column; border-color: #__C_line__; }
.fillcol > .uc:last-child { margin-bottom: 0; }
.uc .main { flex: 1 1 auto; display: flex; flex-direction: column; }
.uc .head { display: flex; gap: 16px; align-items: flex-start; }
.uc .badge { flex: none; width: 56px; height: 56px; line-height: 56px; border-radius: 14px; font-size: __F_card_name__; }
.uc .hd { padding-__S__: 0; flex: 1; min-width: 0; }
.uc .kick { font-size: __F_label__; letter-spacing: 1.4px; }
.uc h3 { font-size: __F_card_name__; line-height: 1.16; margin-top: 3px; }
.uc .sub { font-size: __F_body__; color: #__C_body__; margin-top: 6px; line-height: 1.45; }
.uc .spon { font-size: __F_small__; color: #__C_muted__; margin-top: 6px; }
.uc .spon b { color: #__C_teal__; text-transform: uppercase; letter-spacing: 1px; font-size: __F_label__; margin-__E__: 6px; }
.uc .band { height: 4px; margin: 10px 0 10px; }
.uc table.stats.chipsrow { border-spacing: 8px 0; margin-left: -8px; margin-right: -8px; margin-bottom: 12px; }
.uc table.stats.chipsrow td { padding: 7px 6px; border-radius: 10px; }
.uc table.stats.chipsrow .v { font-size: __F_heading__; }
.uc table.stats.chipsrow .l { font-size: __F_label__; text-transform: uppercase; letter-spacing: .8px; }
.uc .cols { flex: 1 1 auto; display: flex; gap: 0; margin-top: 6px; }
.uc .cols > * { display: block; width: auto; }
.uc .lcol { flex: 0 0 __LCOL__px; padding-__E__: 24px; }
.uc .side { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 14px; padding: 0; }
.uc h5 { font-size: __F_label__; letter-spacing: 1.2px; margin: 0 0 5px; }
.uc .blk { margin-bottom: 11px; }
.uc .lcol .blk:last-child { margin-bottom: 0; }
.uc .blk p { font-size: __F_body__; line-height: 1.5; color: #__C_body2__; }
.uc .panel { background: #__C_sand__; border-radius: 12px; padding: 6px 14px; }
.uc table.kv { font-size: __F_small__; margin: 0; }
.uc table.kv td { padding: 4px 0; line-height: 1.4; }
.uc table.kv td.k { width: 40%; font-size: __F_small__; }
.uc .stake { margin-top: auto; background: #__C_ice__; border-radius: 12px; border-__S__: 4px solid #__C_gold__; padding: 12px 16px; }
.uc .stake h5 { margin-bottom: 2px; }
.uc .stake .money { font-family: __DISPLAY__; font-size: __F_card_title__; font-weight: 700; color: #__C_teal_dark__; line-height: 1.12; }
.uc .stake .money.none { font-family: __BODY__; font-size: __F_small__; color: #__C_muted__; }
.uc .stake .why { font-size: __F_small__; color: #__C_body__; margin-top: 6px; line-height: 1.45; }
.uc .stake .why b { color: #__C_teal__; }
.uc .val { display: flex; gap: 28px; margin-top: 10px; padding-top: 12px; border-top: 1px solid #__C_line__; }
.uc .val > * { display: block; width: auto; flex: 1 1 0; min-width: 0; padding: 0; }
.uc .blk ul { font-size: __F_small__; padding-__S__: 17px; margin: 0; }
.uc .blk li { margin: 0 0 3px; line-height: 1.45; color: #__C_body2__; }
.uc .foot { margin-top: auto; padding-top: 10px; }
.uc .val { margin-top: auto; }
.uc .cols { margin-bottom: 8px; }
.ribbons { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 4px; }
.ribbons .ribbon { margin: 0; padding: 5px 12px; flex: 0 1 auto; }
.uc.roomy .blk p { font-size: 15px; line-height: 1.55; }
.uc.roomy .blk { margin-bottom: 22px; }
.uc.roomy .blk li { font-size: 13.5px; }
.uc.roomy table.kv td { padding: 8px 0; font-size: 13.5px; }
.uc.roomy .sub { font-size: 14.5px; }
.uc.tight .blk p { font-size: 12.5px; line-height: 1.4; }
.uc.tight .blk ul { font-size: 12px; }
.uc.tight .blk li { margin-bottom: 2px; line-height: 1.35; }
.uc.tight .blk { margin-bottom: 8px; }
.uc.tight .sub { font-size: 12.5px; margin-top: 4px; }
.uc.tight .band { margin: 8px 0; }
.uc.tight table.kv td { padding: 3px 0; }
.uc.tight .stake .money { font-size: 32px; }
.uc.tight .stake .why { margin-top: 3px; line-height: 1.35; }
.uc.tight .val { margin-top: 6px; padding-top: 9px; }
.btn { font-size: __F_label__; padding: 6px 14px; }
.ribbon { font-size: __F_small__; padding: 9px 14px; margin-bottom: 10px; }
.story .kick { font-size: __F_label__; }
`;

const BODY_STACK = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
const DISPLAY_STACK = 'Fraunces, Georgia, "Times New Roman", serif';
const W = 794;
const H = 1123;
const ROOM = 979; // A4 less the 19 mm top and bottom margins, in CSS px
const CW = 680; // A4 less the 15 mm side margins
// C26 (REQ-563): the PDF's own type scale in CSS px, set for an executive reading a laptop at 100%: nothing under 11 px.
const F = { numeral: 64, hero: 48, display: 38, title: 28, card_title: 38, card_name: 25, heading: 19, lead: 15, body: 13, small: 12, label: 11, micro: 11 };

// _pdf_css: the agent's sheet with its tokens filled in for one direction.
export function agentPdfCss(m) {
  const [start, end] = m.rtl ? ['right', 'left'] : ['left', 'right'];
  const css = (AGENT_PDF_CSS + PAGE_CSS).replace(/__S__/g, start).replace(/__E__/g, end).replace(/__GDIR__/g, m.rtl ? '270deg' : '90deg')
    .replace(/__LCOL__/g, String(LCOL)).replace(/__BODY__/g, BODY_STACK).replace(/__DISPLAY__/g, m.latinDisplay ? DISPLAY_STACK : BODY_STACK);
  return css.replace(/__C_(\w+?)__/g, (_, k) => DOC_COLORS[k].toLowerCase()).replace(/__F_(\w+?)__/g, (_, k) => `${F[k].toFixed(1)}px`);
}

// ---- text: XML escaping and the agent's bidi rules (_doc_bidi, _doc_bidi_html, _doc_bidi_text, _doc_isolate_ltr) ----
export const esc = (v) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFC]/;
const LRI = '\u2066';
const PDI = '\u2069';
const BRACKETS = { ')': '(', ']': '[', '}': '{' };
const bidiKind = (ch) => (RTL_CHAR.test(ch) ? 'R' : /[\p{L}\p{M}0-9]/u.test(ch) ? 'L' : /[#$%+\u00A2-\u00A5\u00B0\u00B1\u2030\u2031\u20A0-\u20CF]/.test(ch) ? 'T' : 'N');
const hasRtl = (text) => RTL_CHAR.test(String(text ?? ''));
export const isLtrText = (text) => { const s = String(text ?? ''); return !hasRtl(s) && (/\p{L}/u.test(s) || /\d[\s/:]+\S/.test(s)); };
function isolateLtr(text) {
  let s = String(text ?? '');
  if (!hasRtl(s)) return s;
  s = s.split(LRI).join('').split(PDI).join('');
  const chars = [...s];
  const kinds = chars.map(bidiKind);
  const starts = (i) => {
    if (kinds[i] === 'L') return true;
    if (kinds[i] !== 'T') return false;
    let j = i; while (j < chars.length && kinds[j] === 'T') j += 1;
    return j < chars.length && /[0-9]/.test(chars[j]);
  };
  const runEnd = (start) => {
    const stack = []; let best = null;
    for (let j = start; j < chars.length; j += 1) {
      if (kinds[j] === 'R') break;
      const ch = chars[j];
      if ('([{'.includes(ch)) stack.push(ch);
      else if (BRACKETS[ch]) { if (!stack.length || stack[stack.length - 1] !== BRACKETS[ch]) break; stack.pop(); }
      const ends = kinds[j] === 'L' || Boolean(BRACKETS[ch]) || (kinds[j] === 'T' && j > start && ['L', 'T'].includes(kinds[j - 1]));
      if (ends && !stack.length) best = j + 1;
    }
    return best ?? start + 1;
  };
  const out = [];
  for (let i = 0; i < chars.length;) {
    if (!starts(i)) { out.push(chars[i]); i += 1; continue; }
    const end = runEnd(i);
    out.push(LRI + chars.slice(i, end).join('') + PDI);
    i = end;
  }
  return out.join('');
}
const bidiFor = (m) => ({
  dir: (t) => (m.rtl && isLtrText(t) ? ' dir="ltr"' : ''),
  text: (t) => esc(m.rtl ? isolateLtr(t) : t),
  html: (t) => (m.rtl && isLtrText(t) ? `<span dir="ltr">${esc(t)}</span>` : esc(m.rtl ? isolateLtr(t) : t)),
});

// ---- the height model: a greedy word wrap over per-character widths, so pages are cut the same way in Node and in the browser ----
const charWidth = (ch) => {
  if (/\s/.test(ch)) return 0.28;
  if (/[\u1100-\u11FF\u2E80-\uA4CF\uAC00-\uD7AF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch)) return 1.0;
  if (/[mwMW@%\u2014]/.test(ch)) return 0.86;
  if (/[A-Z0-9#$&]/.test(ch)) return 0.66;
  if (/[iljtfr.,;:'!|()[\]\u00B7]/.test(ch)) return 0.32;
  if (/[\u2066\u2069\u200E\u200F]/.test(ch)) return 0;
  if (RTL_CHAR.test(ch)) return 0.46; // Arabic and Hebrew letters run narrower than Latin ones
  return 0.56;
};
const SAFETY = 1.06;
const ZOOM_MAX = 1.3;
// Lines one text takes in a box of `width` px at `size` px (bold and capitals are wider; letter spacing adds per character).
export function linesOf(text, size, width, { bold = false, upper = false, spacing = 0 } = {}) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!s) return 0;
  const scale = size * (bold ? 1.08 : 1) * SAFETY;
  const wordWidth = (w) => [...(upper ? w.toUpperCase() : w)].reduce((a, ch) => a + charWidth(ch) * scale + spacing, 0);
  const space = charWidth(' ') * scale + spacing;
  let lines = 1; let x = 0;
  for (const word of s.split(' ')) {
    let w = wordWidth(word);
    if (x > 0 && x + space + w <= width) { x += space + w; continue; }
    if (x > 0) { lines += 1; x = 0; }
    while (w > width) { lines += 1; w -= width; } // overflow-wrap: a word longer than the line breaks
    x = w;
  }
  return lines;
}
const textHBase = (text, size, width, lh = 1.5, o) => linesOf(text, size, width, o) * size * lh;
const textH = textHBase;
const CARD_CAL = 0.84;

// ---- the shared pieces of the agent sheet (_pdf_wordmark, heading, stats_table, _pdf_index_table) ----
const wordmark = (extra = '') => `<span class="wordmark ${extra}" dir="ltr"><i class="mark"></i>${esc(DOC_BRAND.maker)} <b>${esc(DOC_BRAND.product)}</b></span>`;
// C27 (REQ-564): each section header carries its own deck colour: the eyebrow as a coloured pill and a two-colour rule under the title.
const SECTION_TONES = { contents: ['teal', 'gold'], executive: ['coral', 'gold'], purpose: ['teal_mid', 'green'], domainslist: ['gold', 'coral'], guide: ['green', 'teal_mid'],
  portfolio: ['amber', 'coral'], value: ['green', 'gold'], index: ['teal', 'teal_mid'], methodology: ['teal_mid', 'gold'], foundations: ['amber', 'teal'], roadmap: ['coral', 'amber'], disclaimer: ['teal', 'coral'] };
const toneOf = (section) => (SECTION_TONES[section] || ['teal', 'gold']).map((k) => `#${DOC_COLORS[k].toLowerCase()}`);
const heading = (section, eyebrow, title) => {
  const [c1, c2] = toneOf(section);
  return {
    html: `<div class="sechd" data-section="${section === 'domainslist' ? 'domains-list' : section}"><div class="eyebrow pillb" style="background:${c1}">${esc(eyebrow)}</div>`
      + `<h2 class="title" id="sec-${section}">${esc(title)}</h2><div class="rule wide" style="background:linear-gradient(90deg, ${c1} 0 45%, ${c2} 45% 100%)"></div></div>`,
    h: F.label * 1.5 + 11 + textH(title, F.title, CW, 1.16, { bold: true }) + 25,
  };
};
function statsTable(items, b, extra = '', width = CW, big = extra === 'big') {
  const cells = items.map(([v, l]) => `<td><div class="v">${b.html(v)}</div><div class="l">${esc(l)}</div></td>`).join('');
  const cw = width / Math.max(1, items.length) - 20;
  const vs = big ? F.title : F.heading;
  const h = 16 + Math.max(...items.map(([v, l]) => textH(v, vs, cw, 1.15, { bold: true }) + 2 + textH(l, F.label, cw, 1.25)));
  return { html: `<table class="stats ${extra}"><tr>${cells}</tr></table>`, h };
}
function indexTable(rows, m, b) {
  const T = m.T;
  const cols = DOC_INDEX_COLUMNS.map(([k, labelKey, w]) => [k, labelKey ? T(labelKey) : 'ID', w]);
  const head = `<table class="index"><colgroup>${cols.map(([, , w]) => `<col style="width:${(100 * w).toFixed(1)}%"/>`).join('')}</colgroup>`
    + `<thead><tr>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>`;
  const headH = F.label * 1.5 + 10;
  const body = rows.map((v) => {
    const flag = v.coverage ? v.coverage[0] : '';
    const cells = {
      rank: esc(v.rank), id: `<a>${esc(v.id)}</a>`, title: `${flag ? `<span class="ixflag">${esc(flag)}</span> ` : ''}<a>${b.html(v.title)}</a>`,
      domain: b.html(v.domain), quality: `<span class="pill" style="background:#${qualityColor(v.quality).toLowerCase()}">${b.html(v.quality || T('doc_not_scored'))}</span>`,
      inspire_score: m.rtl ? `<span dir="ltr">${esc(v.metrics[1][2])}</span>` : esc(v.metrics[1][2]),
    };
    const h = 9 + Math.max(...cols.map(([k, , w]) => textH(k === 'title' ? `${flag} ${v.title}` : k === 'quality' ? v.quality : k === 'domain' ? v.domain : k === 'id' ? v.id : '0', F.small, CW * w - 12)));
    return { html: `<tr>${cols.map(([k]) => `<td class="ix-${k}">${cells[k]}</td>`).join('')}</tr>`, h };
  });
  return { open: head, close: '</tbody></table>', headH, rows: body };
}
const tableHtml = (t, rows = t.rows) => ({ html: t.open + rows.map((r) => r.html).join('') + t.close, h: t.headH + rows.reduce((a, r) => a + r.h, 0) });

// ---- pages: a page is its kind, its body html and its height; flow() cuts a section over as many pages as it needs ----
// C26: a page whose blocks are marked grow is drawn as a flex column, so the growing blocks take the room that is left and the page is full.
function flow(out, kind, { head = null, blocks = [], table = null, after = [], extra = {} }) {
  let page = null; const mine = [];
  const open = (first) => { page = { kind, ...extra, parts: [], used: 0, room: ROOM }; out.push(page); mine.push(page); if (first && head) { page.parts.push(head.html); page.used += head.h; } };
  const put = (blk) => {
    if (page.parts.length && page.used + blk.h > ROOM) open(false);
    page.parts.push(blk.html); page.used += blk.h; if (blk.grow) page.grow = true;
  };
  open(true);
  for (const blk of blocks) put(blk);
  if (table) {
    let rows = [];
    const flush = () => { if (!rows.length) return; const t = tableHtml(table.t, rows); page.parts.push(table.wrap ? table.wrap(t.html) : t.html); page.used += t.h + (table.wrapH || 0); rows = []; };
    const startH = () => table.t.headH + (table.wrapH || 0);
    if (page.used + startH() + (table.t.rows[0]?.h || 0) > ROOM) open(false);
    let used = page.used + startH();
    for (const r of table.t.rows) {
      if (rows.length && used + r.h > ROOM) { flush(); open(false); used = page.used + startH(); }
      rows.push(r); used += r.h;
    }
    flush();
  }
  for (const blk of after) put(blk);
  for (const pg of mine) if (pg.grow) { pg.parts = ['<div class="fillcol">', ...pg.parts, '</div>']; pg.used = ROOM; }
  return out;
}
const card = (inner, h, extra = '') => ({ html: `<div class="card ${extra}">${inner}</div>`, h: h + 26 });

// ---- the use case card (_pdf_use_case_card) plus its value; a card taller than a page is cut at block and line boundaries ----
const CARD_IN = CW - 44; // the card's border and 22 px padding each side
const LCOL = Math.round(CARD_IN * 0.57);
const COL = LCOL - 24; // the narrative column's text width
const RCOL = CARD_IN - LCOL; // the facts panel's outer width
const KV_K = (RCOL - 28) * 0.4 - 8;
const KV_V = (RCOL - 28) * 0.6;
const VCOL = CARD_IN / 2 - 16; // the value lists below the columns
const CHUNK = 420; // the most one text block may take before it is cut by sentence

function sentencesOf(text, size, width) {
  const s = String(text ?? '');
  if (textH(s, size, width) <= CHUNK) return [s];
  const parts = s.split(/(?<=[.!?\u061F\u3002])\s+/);
  const out = []; let cur = '';
  for (const p of parts) {
    const next = cur ? `${cur} ${p}` : p;
    if (cur && textH(next, size, width) > CHUNK) { out.push(cur); cur = p; } else cur = next;
  }
  if (cur) out.push(cur);
  return out.flatMap((c) => (textH(c, size, width) <= CHUNK ? [c] : wordsChunks(c, size, width)));
}
function wordsChunks(text, size, width) {
  const words = text.split(' '); const out = []; let cur = '';
  for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (cur && textH(next, size, width) > CHUNK) { out.push(cur); cur = w; } else cur = next; }
  if (cur) out.push(cur);
  return out;
}

function cardPieces(v, m, b) {
  const T = m.T;
  const textH = (...a) => textHBase(...a) * CARD_CAL; // measured against the browser (tools/measure.mjs): the card model ran about 12% tall
  const kicker = [v.id, v.domain, v.subdomain].filter(Boolean).join(' · ');
  const h5H = F.label * 1.3 + 4;
  const sponsor = v.facts.find((f) => f[0] === 'sponsor');
  const hdW = CARD_IN - 72;
  const headHtml = `<div class="head"><div class="badge ${v.kind}">${esc(v.rank)}</div><div class="hd"><div class="kick">${b.html(kicker)}</div>`
    + `<h3${b.dir(v.title)}>${b.text(v.title)}</h3>${v.subtitle ? `<div class="sub"${b.dir(v.subtitle)}>${b.text(v.subtitle)}</div>` : ''}`
    + `${sponsor ? `<div class="spon"><b>${esc(sponsor[1])}</b> ${b.html(sponsor[2])}</div>` : ''}</div></div><div class="band"></div>`;
  const headH = Math.max(56, F.label * 1.5 + 2 + textH(v.title, F.card_name, hdW, 1.16, { bold: true }) + (v.subtitle ? 5 + textH(v.subtitle, F.body, hdW) : 0)
    + (sponsor ? 5 + textH(`${sponsor[1]} ${sponsor[2]}`, F.small, hdW) : 0)) + 24;
  const mw = (CARD_IN + 10) / v.metrics.length - 24;
  const metricsHtml = `<table class="stats chipsrow"><tr>${v.metrics.map(([, l, val]) => `<td><div class="v">${b.html(val)}</div><div class="l">${esc(l)}</div></td>`).join('')}</tr></table>`;
  const metricsH = 24 + Math.max(...v.metrics.map(([, l, val]) => textH(val, F.heading, mw, 1.15, { bold: true }) + 2 + textH(l, F.label, mw, 1.25))) + 12;
  const ribbons = [];
  const ribbonH = (t) => 24 + textH(t, F.small, CARD_IN - 30, 1.5, { bold: true });
  if (v.meetsBar) ribbons.push({ html: `<div class="ribbon meets"><b>${esc(v.meetsBar)}</b></div>`, h: ribbonH(v.meetsBar) });
  if (v.star) ribbons.push({ html: `<div class="ribbon star"><b>${b.html(v.star)}</b></div>`, h: ribbonH(v.star) });
  if (v.coverage) {
    const [label, reasonLabel, reason] = v.coverage;
    ribbons.push({ html: `<div class="ribbon"><b>${esc(label)}</b>. ${esc(reasonLabel)}: ${b.html(reason)}</div>`, h: ribbonH(`${label}. ${reasonLabel}: ${reason}`) });
  }
  // The ribbons sit side by side when they are short, so they take one row.
  const rw = ribbons.length ? (ribbons.length === 1 || ribbons.every((r) => r.h <= 40) ? Math.max(...ribbons.map((r) => r.h)) + 6 : ribbons.reduce((a, r) => a + r.h, 0)) : 0;
  const top = { html: headHtml + metricsHtml + (ribbons.length ? `<div class="ribbons">${ribbons.map((r) => r.html).join('')}</div>` : ''), h: headH + metricsH + rw };
  // The narrative (left) and the facts panel with the value at stake (right): one item per block, long texts cut into sentence chunks.
  const left = v.narrative.flatMap(([, label, value]) => sentencesOf(value, F.body, COL).map((chunk, i) => ({
    html: `<div class="blk">${i ? '' : `<h5>${esc(label)}</h5>`}<p${b.dir(chunk)}>${b.text(chunk)}</p></div>`, h: (i ? 0 : h5H) + textH(chunk, F.body, COL) + 14,
  })));
  const right = v.facts.filter((f) => f !== sponsor).map(([, label, value]) => ({
    fact: true, html: `<tr><td class="k">${esc(label)}</td><td>${b.html(value)}</td></tr>`,
    h: 11 + Math.max(textH(label, F.small, KV_K, 1.5, { bold: true }), textH(value, F.small, KV_V)),
  }));
  // C25/C26: the value a year of this use case: the hero number, its basis and, for an estimate, the note.
  const s = v.value;
  const why = s.amount === null ? '' : [[T('value_basis'), s.basis], s.note ? [T('value_note'), s.note] : null, s.story ? [T('value_story'), s.story] : null].filter(Boolean);
  const whyW = RCOL - 34;
  right.push({
    html: `<div class="stake"><h5>${esc(T('value_at_stake'))}</h5><div class="money${s.amount === null ? ' none' : ''}">${b.html(s.text)}</div>`
      + `${why ? why.map(([k, t]) => `<div class="why"><b>${esc(k)}</b>: ${b.html(t)}</div>`).join('') : ''}</div>`,
    h: 36 + h5H + (s.amount === null ? F.small * 1.5 : F.card_title * 1.15) + (why ? why.reduce((a, [k, t]) => a + 6 + textH(`${k}: ${t}`, F.small, whyW), 0) : 0),
  });
  const renderSide = (r) => {
    const facts = r.filter((x) => x.fact); const rest = r.filter((x) => !x.fact);
    return `${facts.length ? `<div class="panel"><table class="kv">${facts.map((x) => x.html).join('')}</table></div>` : ''}${rest.map((x) => x.html).join('')}`;
  };
  const cols = { left, right, render: (l, r) => `<div class="cols txt"><div class="lcol">${l.map((x) => x.html).join('')}</div><div class="side">${renderSide(r)}</div></div>`, pad: 6,
    extra: (r) => (r.some((x) => x.fact) ? 28 : 0) + (r.length > 1 && r.some((x) => x.fact) ? 14 : 0) };
  const valueItems = (facts) => facts.flatMap(([, label, items]) => items.flatMap((item) => sentencesOf(item, F.small, VCOL - 16)).map((item, i) => ({
    label: i ? '' : label, html: `<li${b.dir(item)}>${b.text(item)}</li>`, h: (i ? 0 : h5H + 6) + textH(item, F.small, VCOL - 16) + 5,
  })));
  const valueBlock = (items) => {
    const groups = [];
    for (const it of items) { if (it.label || !groups.length) groups.push({ label: it.label, items: [] }); groups[groups.length - 1].items.push(it.html); }
    return groups.map((g) => `<div class="blk">${g.label ? `<h5>${esc(g.label)}</h5>` : ''}<ul>${g.items.join('')}</ul></div>`).join('');
  };
  // The value lists run in two columns, cut at the group boundary that balances their heights.
  const valAll = [...valueItems(v.valueFacts.filter((f) => DOC_VALUE_LEFT.includes(f[0]))), ...valueItems(v.valueFacts.filter((f) => !DOC_VALUE_LEFT.includes(f[0])))];
  const valSum = valAll.reduce((a, x) => a + x.h, 0);
  let run = 0; let cut = valAll.length; let best = valSum;
  for (const [i, x] of valAll.entries()) { if (x.label && i > 0 && Math.abs(valSum - 2 * run) < best) { best = Math.abs(valSum - 2 * run); cut = i; } run += x.h; }
  const valLeft = valAll.slice(0, cut); const valRight = valAll.slice(cut);
  const val = v.valueFacts.length ? { left: valLeft, right: valRight, render: (l, r) => `<div class="val"><div>${valueBlock(l)}</div><div>${valueBlock(r)}</div></div>`, pad: 26 } : null;
  const foot = v.notebook ? { html: `<div class="foot"><span class="btn">${esc(T('doc_open_notebook'))} ↗</span></div>`, h: 10 + F.label * 1.5 + 10 } : { html: '', h: 0 };
  // C27 (REQ-564): two charts under the head: the lead one shows the kind of result its technique gives, the second its scores or value years.
  const chartW = Math.floor((CARD_IN - 14) / 2); const chartH = 188;
  const charts = { html: `<div class="ucharts">${chartTypesFor(v).slice(0, 2).map((t) => ucChartSvg(t, v, { w: chartW, h: chartH })).join('')}</div>`, h: chartH + 14 };
  const segs = [top, charts, cols, ...(val ? [val] : []), foot];
  const segH = (seg) => (seg.render ? seg.pad + (seg.extra ? seg.extra(seg.right) : 0) + Math.max(seg.left.reduce((a, x) => a + x.h, 0), seg.right.reduce((a, x) => a + x.h, 0)) : seg.h);
  const shell = 38 + 14; // border, padding and the gap below the card
  const total = shell + segs.reduce((a, seg) => a + segH(seg), 0);
  const roomy = total <= ROOM * 0.8;
  const tight = total > ROOM && total <= ROOM * 1.14; // a card a little over a page is set tighter instead of cut
  const article = (inner, cont) => `<article class="uc${v.kind ? ` ${v.kind}` : ''}${cont ? ' cont' : ''}${roomy ? ' roomy' : ''}${tight ? ' tight' : ''}" data-uc="${esc(v.id)}"${cont ? '' : ` id="uc-${esc(v.id)}"`}><div class="main">${inner}</div></article>`;
  if (total <= ROOM * (tight ? 1.14 : 1)) return [{ html: article(segs.map((seg) => (seg.render ? seg.render(seg.left, seg.right) : seg.html)).join(''), false), h: total, grow: true }];
  // Too tall for one page: pieces of at most a page each, the next ones headed by the id and the title.
  const contHead = { html: `<div class="kick">${b.html(kicker)}</div><h3${b.dir(v.title)}>${b.text(v.title)}</h3>`, h: F.label * 1.5 + textH(v.title, F.card_name, CARD_IN, 1.16, { bold: true }) + 14 };
  const cap = ROOM;
  const pieces = []; let parts = []; let used = shell;
  const close = () => { pieces.push({ html: article(parts.join(''), pieces.length > 0), h: used, grow: true }); parts = [contHead.html]; used = shell + contHead.h; };
  for (const seg of segs) {
    if (!seg.render) {
      if (parts.length > (pieces.length ? 1 : 0) && used + seg.h > cap) close();
      parts.push(seg.html); used += seg.h; continue;
    }
    let l = [...seg.left]; let r = [...seg.right];
    while (l.length || r.length) {
      const avail = cap - used - seg.pad - (seg.extra ? 42 : 0);
      const take = (list) => { const got = []; let h = 0; while (list.length && h + list[0].h <= avail) { h += list[0].h; got.push(list.shift()); } return [got, h]; };
      let [gl, hl] = take(l); let [gr, hr] = take(r);
      if (!gl.length && !gr.length) {
        if (parts.length > (pieces.length ? 1 : 0)) { close(); continue; }
        if (l.length) { gl = [l.shift()]; hl = gl[0].h; } else { gr = [r.shift()]; hr = gr[0].h; }
      }
      parts.push(seg.render(gl, gr)); used += seg.pad + (seg.extra ? seg.extra(gr) : 0) + Math.max(hl, hr);
      if (l.length || r.length) close();
    }
  }
  pieces.push({ html: article(parts.join(''), pieces.length > 0), h: used, grow: true });
  for (const pc of pieces) pc.h = ROOM; // each piece has its own page, stretched to fill it
  return pieces;
}


// REQ-561: the value story page of one use case, right after its card: the amount with its basis and note, the story, where the value comes from
// (factors with their share), the formula of each factor in plain words and the projection. A long story or formula spills onto more pages.
function storyPage(out, v, m, b, domain) {
  const T = m.T; const s = v.value; const IN = CW - 30;
  const kicker = [v.id, v.domain, v.subdomain].filter(Boolean).join(' \u00B7 ');
  const title = `${T('value_story')}: ${v.title}`;
  const head = { html: `<div class="story" data-story="${esc(v.id)}"><div class="kick">${b.html(kicker)}</div></div><h2 class="title"${b.dir(title)}>${b.text(title)}</h2><div class="rule"></div>`,
    h: F.label * 1.5 + 4 + textH(title, F.title, CW, 1.16, { bold: true }) + 25 };
  const why = [[T('value_basis'), s.basis], s.note ? [T('value_note'), s.note] : null].filter(Boolean);
  const IN2 = CW - 44;
  const whyW = CW * 0.56 - 44;
  const wrap = (html, h, grow = false) => ({ html: `<div class="story${grow ? ' grow' : ''}" data-story="${esc(v.id)}">${html}</div>`, h, grow });
  // The hero number with its basis, then the story as a lead paragraph.
  const blocks = [wrap(`<div class="sum"><div class="amt"><h5>${esc(T('value_at_stake'))}</h5><div class="money">${b.html(s.text)}</div></div>`
    + `<div class="why">${why.map(([k, t]) => `<div><b>${esc(k)}</b>: ${b.html(t)}</div>`).join('')}</div></div>`,
  38 + 14 + Math.max(F.label * 1.3 + 4 + F.hero * 1.15, why.reduce((a, [k, t]) => a + 6 + textH(`${k}: ${t}`, F.small, whyW), 0)) + 14)];
  if (s.story) for (const [i, chunk] of sentencesOf(s.story, F.lead, IN2 - 24).entries()) {
    blocks.push(wrap(`<div class="lede">${i ? '' : `<h5>${esc(T('value_story'))}</h5>`}<p${b.dir(chunk)}>${b.text(chunk)}</p></div>`, (i ? 0 : F.label * 1.3 + 4) + textH(chunk, F.lead, IN2 - 24, 1.55) + 28 + 14));
  }
  // The 3-year projection: bars (low, likely, high per year) with the table under them.
  if (s.projection.length) {
    const num = (t) => { const mm = /(\d[\d.,]*)\s*([KMBkmb])?/.exec(String(t)); if (!mm) return 0; const x = parseFloat(mm[1].replace(/,/g, '')); return Number.isFinite(x) ? x * ({ k: 1e3, m: 1e6, b: 1e9 }[(mm[2] || '').toLowerCase()] || 1) : 0; };
    const top = Math.max(1, ...s.projection.map((y) => num(y.high)), ...s.projection.map((y) => num(y.likely)));
    const bar = (cls, label, text) => `<div class="col"><div class="bv" dir="ltr">${b.html(text)}</div><div class="b ${cls}" style="height:${Math.max(3, (100 * num(text)) / top).toFixed(1)}%"></div></div>`;
    const groups = s.projection.map((y) => `<div class="yg"><div class="plot">${bar('low', T('value_low'), y.low)}${bar('likely', T('value_likely'), y.likely)}${bar('high', T('value_high'), y.high)}</div><div class="yl">${esc(T('value_year_n', { n: y.year }))}</div></div>`).join('');
    const legend = [['low', T('value_low')], ['likely', T('value_likely')], ['high', T('value_high')]].map(([c, l]) => `<span><i class="sw ${c}"></i>${esc(l)}</span>`).join('');
    const cell = (x) => `<td dir="ltr">${b.html(x)}</td>`;
    const rows = s.projection.map((y) => `<tr><td>${esc(T('value_year_n', { n: y.year }))}</td>${cell(y.low)}<td class="lk" dir="ltr">${b.html(y.likely)}</td>${cell(y.high)}</tr>`).join('');
    const table = `<table class="proj"><thead><tr><th>${esc(T('value_year'))}</th><th>${esc(T('value_low'))}</th><th>${esc(T('value_likely'))}</th><th>${esc(T('value_high'))}</th></tr></thead><tbody>${rows}</tbody></table>`;
    blocks.push(wrap(`<div class="pcard"><div class="phd"><h4>${esc(T('value_projection'))}</h4><div class="legend2">${legend}</div></div><div class="chart">${groups}</div>${table}</div>`,
      46 + 220 + F.label * 1.5 + 8 + s.projection.length * (F.small * 1.5 + 10) + 30, true));
  }
  // Where the value comes from: each driver as a bar with its share and its formula in plain words.
  if (s.factors.length) {
    const rows = s.factors.map((f) => `<div class="drv"><div class="dh"><span class="dn">${b.html(f.name)}</span><span class="ds">${esc(f.share)}%</span></div><div class="track"><div class="fill" style="width:${Math.max(4, f.share)}%"></div></div>`
      + `${f.formula ? `<div class="df"${b.dir(f.formula)}>${b.text(f.formula)}</div>` : ''}</div>`).join('');
    blocks.push(wrap(`<div class="dcard"><h4>${esc(T('value_source'))}</h4>${rows}</div>`,
      60 + s.factors.reduce((a, f) => a + 24 + 14 + (f.formula ? textH(f.formula, F.small, IN2, 1.45) + 4 : 0) + 14, 0)));
  }
  flow(out, 'story', { head, blocks, extra: { domain } });
}

// ---- the sections, in the order of _catalog_pdf_html, plus the value page after the last domain ----
const ACCENTS = ['teal', 'coral', 'gold', 'teal_mid', 'green', 'amber'].map((k) => DOC_COLORS[k].toLowerCase());
const MIN_SHARE = 1.5;
function shares(counts) {
  const c = counts.map((n) => Math.max(0, Math.trunc(n || 0)));
  const total = c.reduce((a, n) => a + n, 0);
  if (total <= 0) return c.map(() => 0);
  const floor = MIN_SHARE * c.filter(Boolean).length <= 100 ? MIN_SHARE : 0;
  const small = c.map((n) => Boolean(n) && (100 * n) / total < floor);
  const rest = c.reduce((a, n, i) => a + (small[i] ? 0 : n), 0);
  const room = 100 - floor * small.filter(Boolean).length;
  const raw = c.map((n, i) => (small[i] ? floor : rest ? (room * n) / rest : 0));
  const hundredths = raw.map((v) => Math.trunc(v * 100));
  const order = raw.map((_, i) => i).sort((a, b) => raw[b] * 100 - hundredths[b] - (raw[a] * 100 - hundredths[a]));
  for (const i of order.slice(0, Math.max(0, 10000 - hundredths.reduce((a, n) => a + n, 0)))) hundredths[i] += 1;
  return hundredths.map((h) => h / 100);
}

function sections(m) {
  const T = m.T; const b = bidiFor(m); const out = [];
  const para = (ps, size, width, lh) => ps.map((p, i) => ({ html: `<p class="${i === 0 ? 'first' : ''}"${b.dir(p)}>${b.text(p)}</p>`, h: textH(p, size, width, lh) + 9 }));
  // Cover
  const glass = m.headline.slice(0, 3).map(([v, l]) => `<td><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div></td>`).join('');
  out.push({ kind: 'cover', bleed: true, room: H, used: 860, parts: [`<section class="cover">${artSvg('rings')}${artSvg('net')}<div class="inner">${wordmark('light big')}`
    + `<div class="kick">${esc(T('doc_catalog_kicker'))} \u00B7 <span dir="ltr">${esc(m.date)}</span></div><h1>${esc(T('pdf_title'))}</h1>`
    + `<div class="for">${esc(T('doc_prepared_for'))}</div><div class="biz">${b.html(m.businessName)}</div>`
    + `${m.mode ? `<div class="modepill">${esc(T('doc_quality_mode'))}: ${esc(m.modeLabel)}</div>` : ''}<table class="glass"><tr>${glass}</tr></table></div>`
    + `<div class="foot"><div class="meta">${b.html(m.generatedBy)}</div></div></section>`] });
  // Contents: the page numbers are filled in once every page is cut.
  // C27: the PDF's contents add the purpose and domains list pages after the executive summary (the deck keeps agentOutline as is).
  const base = agentOutline(m); const at = base.findIndex((o) => o[0] === 'executive') + 1;
  const outline = [...base.slice(0, at), ...(m.language === 'English' ? [['purpose', T('doc_purpose_title'), T('doc_purpose_kicker')]] : []),
    ['domainslist', T('doc_domains_list_title'), `${m.domains.length} ${T('doc_domains')}`], ...base.slice(at)];
  const tile = ([key, title, sub], i) => `<div class="it"><span class="n" style="background:#${ACCENTS[i % ACCENTS.length]}">${String(i + 1).padStart(2, '0')}</span>`
    + `<span class="tx"><span class="t">${esc(title)}</span><div class="s"${b.dir(sub)}>${b.text(sub)}</div></span><a class="pgn">@@PG:${key}@@</a></div>`;
  const tw = CW / 2 - 28 - 40;
  const rows = []; let tocH = 0;
  for (let i = 0; i < outline.length; i += 2) {
    const pair = outline.slice(i, i + 2);
    rows.push(`<div class="tr">${pair.map((o, j) => tile(o, i + j)).join('')}</div>`);
    tocH += 34 + Math.max(...pair.map(([, t, s]) => Math.max(30, textH(t, F.lead, tw * 0.68 * 1.5, 1.5, { bold: true }) + 2 + textH(s, F.small, tw * 0.68 * 1.5))));
  }
  flow(out, 'contents', { head: heading('contents', m.businessName, T('doc_contents')), blocks: [{ html: `<div class="toc">${rows.join('')}</div>`, h: tocH }] });
  // Executive summary
  // C27 (REQ-564): the executive summary is its own page: the headline numbers, two portfolio charts and 180 to 300 words built from the data
  // (English; another language keeps the translated session summary). A bar notice stays first.
  const notices = m.executive.slice(0, Math.max(0, m.executive.length - (m.summary?.length || 2)));
  const english = m.language === 'English';
  const exec = para([...notices, ...(english ? execSummaryParas(m) : m.executive.slice(notices.length))], F.body + 1, CW, 1.55);
  const stats = statsTable(m.headline, b, 'big');
  const pw = Math.floor((CW - 14) / 2); const ph = 220;
  const valued = m.ranked.some((u) => u.value.amount !== null);
  const pcharts = { html: `<div class="pcharts">${[valued ? 'domain-value' : 'domain-donut', 'top'].map((t) => portfolioChartSvg(t, m.ranked, { w: pw, h: ph })).join('')}</div>`, h: ph + 18 };
  flow(out, 'exec', { head: { html: heading('executive', T('doc_exec_kicker'), T('pdf_exec_summary')).html + stats.html, h: heading('executive', '', T('pdf_exec_summary')).h + stats.h + 13 },
    blocks: [pcharts, ...exec.map((p) => ({ html: `<div class="txt exec">${p.html}</div>`, h: p.h }))], extra: { section: 'executive', cls: 'exec' } });
  // C27: what this catalog is for (data-section="purpose"), with the priority matrix and the quality mix.
  if (english) {
    const pp = para(purposeParas(m), F.lead, CW, 1.6);
    const ph2 = 230;
    flow(out, 'purpose', { head: heading('purpose', T('doc_purpose_kicker'), T('doc_purpose_title')), extra: { section: 'purpose' },
      blocks: [...pp.map((p) => ({ html: `<div class="txt purp">${p.html}</div>`, h: p.h + 2 })),
        { html: `<div class="pcharts">${['matrix', 'quality-mix'].map((t) => portfolioChartSvg(t, m.ranked, { w: pw, h: ph2 })).join('')}</div>`, h: ph2 + 18 }] });
  }
  // C27: the business domains list (data-section="domains-list"): every domain with its use cases, value, best score and what it covers.
  const dl = domainsListOf(m.ranked);
  const dlValue = dl.some((d) => d.value);
  const dlW = CW - 20 - 10 - 150 - (dlValue ? 3 : 2) * (64 + 12) - 12;
  const dlRows = dl.map((d, i) => {
    const desc = english ? d.description.replace(/;.*$/, '.') : '';
    const c = ACCENTS[i % ACCENTS.length];
    return { html: `<div class="dlrow"><i class="sw" style="background:#${c}"></i><div class="dn"${b.dir(d.domain)}>${b.text(d.domain)}</div><div class="dd"${b.dir(desc)}>${b.text(desc)}</div>`
      + `<div class="dk"><b>${d.count}</b>${esc(T('doc_dl_count'))}</div>${dlValue ? `<div class="dk"><b dir="ltr">${d.value ? esc(d.value.text) : '\u2013'}</b>${esc(T('value_year'))}</div>` : ''}`
      + `<div class="dk"><b dir="ltr">${d.bestScore === null ? '\u2013' : esc(d.bestScore.toFixed(1))}</b>${esc(T('doc_dl_best'))}</div></div>`,
    h: 5 + 14 + Math.max(textH(d.domain, F.body, 150, 1.5, { bold: true }), textH(desc, F.small, dlW, 1.4), F.heading * 1.2 + F.label * 1.25) };
  });
  const dlLead = T('doc_domains_list_lead');
  // The domain chart takes the room the rows leave (up to 250 px); with too little room it is left out, so the list stays on one page when it can.
  const dlHead = heading('domainslist', '', T('doc_domains_list_title')).h + textH(dlLead, F.lead, CW) + 12;
  const dlFree = ROOM - dlHead - dlRows.reduce((a, r) => a + r.h, 0) - 18 - 8;
  const dlChartH = Math.min(250, dlFree >= 140 ? dlFree : 250);
  flow(out, 'domainslist', { head: { html: heading('domainslist', T('doc_domains_list_kicker'), T('doc_domains_list_title')).html + `<p class="lead">${esc(dlLead)}</p>`,
    h: dlHead }, extra: { section: 'domainslist' },
    blocks: [...dlRows, ...(dlFree >= 140 || dlFree < 0 ? [{ html: `<div class="pcharts">${portfolioChartSvg(valued ? 'domain-value' : 'domain-donut', m.ranked, { w: CW, h: dlChartH })}</div>`, h: dlChartH + 18 }] : [])] });
  // How to read
  const half = CW / 2 - 6 - 28;
  const legend = DOC_QUALITY_ORDER.map((l) => `<span><i class="dot" style="background:#${qualityColor(l).toLowerCase()}"></i>${esc(l)} <b>${m.qualityCounts[l]}</b></span>`).join('');
  const modeRows = [['Good', 'doc_mode_good_body', 'value_mode_good'], ['High', 'doc_mode_high_body', 'value_mode_high'], ['Ultra High', 'doc_mode_ultra_body', 'value_mode_ultra_high']]
    .map(([mode, body, key]) => `<div class="mrow${mode === m.mode ? ' on' : ''}"><b>${esc(T(key))}</b>${mode === m.mode ? `<span class="tag">${esc(T('doc_this_catalog'))}</span>` : ''}<br/>${esc(T(body))}</div>`).join('');
  const cardH = (title, body, extra = 0) => F.heading * 1.16 + 6 + textH(body, F.body, half) + 7 + extra;
  const g1 = Math.max(cardH(T('doc_inspire_score_title'), T('doc_inspire_score_body'), 40), cardH(T('doc_quality_tiers_title'), T('doc_quality_tiers_body'), 3 * F.small * 1.5)) + 26;
  const g2 = Math.max(F.heading * 1.16 + 6 + ['doc_mode_good_body', 'doc_mode_high_body', 'doc_mode_ultra_body'].reduce((a, k) => a + 14 + F.body * 1.5 + textH(T(k), F.body, half - 16), 0),
    cardH(T('doc_elite_score_title'), T('doc_elite_score_body')) + 26 + 13 + cardH(T('doc_coverage_title'), T('doc_coverage_body'))) + 26 + 13;
  flow(out, 'guide', { head: heading('guide', T('doc_guide_kicker'), T('doc_how_to_read')), extra: { section: 'guide', sand: true }, blocks: [
    { html: `<p class="lead">${esc(T(m.guideLeadKey))}</p>`, h: textH(T(m.guideLeadKey), F.lead, CW) + 19 },
    { html: `<div class="grid2"><div class="card"><h4>${esc(T('doc_inspire_score_title'))}</h4><p>${esc(T('doc_inspire_score_body'))}</p><div class="scale"></div><div class="scale-l"><span>0</span><span>5</span><span>10</span></div></div>`
      + `<div class="card"><h4>${esc(T('doc_quality_tiers_title'))}</h4><p>${esc(T('doc_quality_tiers_body'))}</p><div class="legend">${legend}</div></div></div>`, h: g1 },
    { html: `<div class="grid2 gap"><div class="card soft modes"><h4>${esc(T('doc_modes_title'))}</h4>${modeRows}</div><div><div class="card"><h4>${esc(T('doc_elite_score_title'))}</h4><p>${esc(T('doc_elite_score_body'))}</p></div>`
      + `<div class="card gap"><h4>${esc(T('doc_coverage_title'))}</h4><p>${esc(T('doc_coverage_body'))}</p></div></div></div>`, h: g2 },
  ] });
  // Portfolio at a glance
  const maxCount = Math.max(1, ...m.domains.map((d) => d.useCases.length));
  const barRows = m.domains.map((d) => `<tr><td class="nm"><a>${b.html(d.name)}</a></td><td><div class="track"><div class="fill" style="width:${Math.max(4, (100 * d.useCases.length) / maxCount).toFixed(1)}%"></div></div></td><td class="n">${d.useCases.length}</td></tr>`).join('');
  const barsH = m.domains.reduce((a, d) => a + 7 + textH(d.name, F.small, half * 0.36), 0);
  const seg = shares(m.qualityRows.map((r) => r[1]));
  const segments = m.qualityRows.map(([l], i) => `<span style="width:${seg[i].toFixed(2)}%;background:#${qualityColor(l).toLowerCase()}"></span>`).join('');
  const qrows = m.qualityRows.map(([l, n, name]) => `<tr><td><i class="dot" style="background:#${qualityColor(l).toLowerCase()}"></i>${esc(name)}</td><td class="n">${n}</td></tr>`).join('');
  const qH = 32 + m.qualityRows.length * (F.small * 1.5 + 7);
  const topT = tableHtml(indexTable(m.top, m, b));
  flow(out, 'portfolio', { head: heading('portfolio', T('doc_portfolio_kicker'), T('doc_portfolio_glance')), extra: { section: 'portfolio' }, blocks: [
    { html: `<div class="grid2"><div class="card"><h4>${esc(T('doc_per_domain'))}</h4><table class="bars">${barRows}</table></div><div class="card soft"><h4>${esc(T('doc_quality_distribution'))}</h4><div class="stack">${segments}</div><table class="qrows">${qrows}</table></div></div>`,
      h: 34 + F.heading * 1.16 + 6 + Math.max(barsH, qH) },
    card(`<h4>${esc(T('doc_top_use_cases'))}</h4>${topT.html}`, F.heading * 1.16 + 6 + topT.h + 13, 'gap'),
  ] });
  // Per domain (or objective): the opener page, then its cards
  for (const d of m.domains) {
    out.push(...openerPage(d, m, b));
    // REQ-561: a use case with a value is followed by its value story page; the cards before it are cut onto their pages first.
    let pending = [];
    const flush = () => { if (pending.length) flow(out, 'cards', { blocks: pending, extra: { domain: d.index } }); pending = []; };
    for (const v of d.useCases) {
      pending.push(...cardPieces(v, m, b));
      if (v.value.amount !== null) { flush(); storyPage(out, v, m, b, d.index); }
    }
    flush();
  }
  valuePages(out, m, b);
  // Index
  const ix = indexTable(m.ranked, m, b);
  flow(out, 'index', { head: { html: heading('index', T('doc_appendix'), T('doc_use_case_index')).html + `<p class="lead">${esc(T('doc_index_lead', { count: m.total }))}</p>`,
    h: heading('index', '', T('doc_use_case_index')).h + textH(T('doc_index_lead', { count: m.total }), F.lead, CW) + 12 }, table: { t: ix }, extra: { section: 'index' } });
  // Methodology and glossary
  const steps = m.methodSteps.map((s, i) => `<li><span class="k">${i + 1}</span>${esc(s)}</li>`).join('');
  const stepsH = m.methodSteps.reduce((a, s) => a + 15 + textH(s, F.body, CW - 28 - 36, 1.4), 0);
  const gloss = m.glossary.map(([t, x]) => `<div class="g"><b>${esc(t)}</b>: ${esc(x)}</div>`).join('');
  const glossH = F.heading * 1.16 + 6 + m.glossary.reduce((a, [t, x]) => a + 11 + textH(`${t}: ${x}`, F.small, CW - 28), 0);
  flow(out, 'methodology', { head: heading('methodology', T('doc_appendix'), T('doc_methodology')), extra: { section: 'methodology', sand: true },
    blocks: [card(`<ol class="steps">${steps}</ol>`, stepsH), card(`<h4>${esc(T('doc_glossary'))}</h4>${gloss}`, glossH + 13, 'gap gloss')] });
  // Foundations
  if (m.foundations.length) {
    const sep = m.language === 'Arabic' ? '\u060C ' : ['Japanese', 'Chinese (Mandarin)'].includes(m.language) ? '\u3001' : ', ';
    const t = {
      open: `<table class="index found"><colgroup><col style="width:8%"/><col style="width:52%"/><col style="width:40%"/></colgroup><thead><tr><th></th><th>${esc(T('doc_foundation_tables'))}</th><th>${esc(T('doc_foundation_unlocks'))}</th></tr></thead><tbody>`,
      close: '</tbody></table>', headH: F.label * 1.5 + 10,
      rows: m.foundations.map((r) => {
        const ids = `${r.count} \u00B7 ${r.useCaseIds.join(sep)}${r.more ? ` (+${r.more})` : ''}`;
        return { html: `<tr><td class="ix-id">${esc(r.id)}</td><td>${b.html(r.tables)}${r.joins ? `<span class="jn">${b.html(r.joins)}</span>` : ''}</td><td><b>${r.count}</b> \u00B7 ${r.useCaseIds.map((id) => `<a>${esc(id)}</a>`).join(sep)}${r.more ? ` (+${r.more})` : ''}</td></tr>`,
          h: 9 + Math.max(textH(r.tables, F.small, CW * 0.52 - 12) + (r.joins ? 2 + textH(r.joins, F.label, CW * 0.52 - 12) : 0), textH(ids, F.small, CW * 0.4 - 12)) };
      }),
    };
    flow(out, 'foundations', { head: { html: heading('foundations', T('doc_next_steps'), T('doc_foundations_title')).html + `<p class="lead">${esc(T('doc_foundations_lead'))}</p>`,
      h: heading('foundations', '', T('doc_foundations_title')).h + textH(T('doc_foundations_lead'), F.lead, CW) + 12 }, table: { t }, extra: { section: 'foundations' } });
  }
  // Roadmap
  const rw = CW / m.roadmap.length - 34;
  const road = m.roadmap.map(([t, x], i) => `<td style="border-top-color:#${ACCENTS[i % ACCENTS.length]}"><span class="k" style="background:#${ACCENTS[i % ACCENTS.length]}">${i + 1}</span><h4>${esc(t)}</h4><p>${esc(x)}</p></td>`).join('');
  const roadH = 28 + 26 + Math.max(...m.roadmap.map(([t, x]) => textH(t, F.body, rw, 1.16, { bold: true }) + 12 + textH(x, F.small, rw)));
  flow(out, 'roadmap', { head: heading('roadmap', T('doc_next_steps'), T('doc_roadmap')), extra: { section: 'roadmap' }, blocks: [
    { html: `<table class="road"><tr>${road}</tr></table>`, h: roadH },
    { html: `<div class="callout gap">${esc(T('doc_closing_body'))}</div>`, h: 13 + 24 + textH(T('doc_closing_body'), F.lead, CW - 32) } ] });
  // Disclaimer: each item is a block, so a long list goes on over pages.
  const items = m.disclaimer.map((x, i) => ({ html: `<div class="card disc"><div class="item"><span class="k">${i + 1}</span>${esc(x)}</div></div>`, h: 26 + 22 + textH(x, F.lead, CW - 28 - 44, 1.55) }));
  flow(out, 'disclaimer', { head: heading('disclaimer', DOC_BRAND.wordmark, m.disclaimerTitle), extra: { section: 'disclaimer', sand: true }, blocks: items });
  // Closing
  out.push({ kind: 'closing', bleed: true, room: H, used: 700, parts: [`<section class="closing">${artSvg('rings')}<div class="in"><div class="kick">${esc(T('doc_next_steps'))}</div>`
    + `<h2>${esc(T('doc_closing_title'))}</h2><div class="gold">${b.html(m.businessName)}</div><div class="sum">${b.text(m.closingSummary)}</div>${wordmark('light big')}`
    + `<div class="meta">${b.html(m.generatedBy)}</div></div></section>`] });
  return out;
}

// _pdf_domain_opener, C26: a full divider page. The band with the number and name, the domain's value and counts as big tiles, what it covers,
// then every use case of the domain as a card (rank, name, one line, value a year, quality). The cards grow to fill the page; a domain with
// more use cases than one page holds goes on over further pages.
const DC_MIN = 66; // the least height of one use case card, with its gap
function openerPage(d, m, b) {
  const T = m.T;
  const number = String(d.index).padStart(2, '0');
  const subtitle = docJoin(d.subdomains.slice(0, 5).map(([n]) => n), m.language);
  const chips = d.subdomains.slice(0, 12).map(([n, c]) => `<span class="chip">${b.html(n)} <b>${c}</b></span>`).join('');
  const tiles = [...(d.value && d.value.amount > 0 ? [[d.value.text, T('value_year')]] : []), ...d.stats];
  const cells = tiles.map(([v, l]) => `<td><div class="v">${b.html(v)}</div><div class="l">${esc(l)}</div></td>`).join('');
  const label = T(m.groupLabelKey);
  const firstSentence = (t) => { const x = String(t ?? '').split(/(?<=[.!?؟。])\s/)[0].trim(); return x.length > 150 ? `${x.slice(0, 147).replace(/\s+\S*$/, '')}...` : x; };
  const dcard = (v) => {
    const line = firstSentence(v.narrative[0]?.[2]);
    const q = v.quality ? `<span class="pill" style="background:#${qualityColor(v.quality).toLowerCase()}">${b.html(v.quality)}</span>` : '';
    return `<div class="dc"><div class="rk ${v.kind}">${esc(v.rank)}</div><div class="dt"><div class="dn"${b.dir(v.title)}>${b.text(v.title)}</div>${line ? `<div class="dl"${b.dir(line)}>${b.text(line)}</div>` : ''}</div>`
      + `<div class="dv">${v.value.amount !== null ? `<div class="dm">${b.html(v.value.text)}</div>` : ''}${q}</div></div>`;
  };
  // C27: the value of every domain as bars with this one marked, so a domain with few use cases still fills its page like a report page.
  const vrows = (() => {
    const all = m.value.byDomain.filter((r) => r.amount > 0);
    if (!all.length || !(d.value && d.value.amount > 0)) return [];
    const sorted = [...all].sort((a, c) => c.amount - a.amount);
    const pick = sorted.slice(0, 7); if (!pick.some((r) => r.index === d.index)) pick.splice(6, 1, all.find((r) => r.index === d.index));
    return pick.sort((a, c) => c.amount - a.amount);
  })();
  const vmax = Math.max(1, ...vrows.map((r) => r.amount));
  const vblock = vrows.length ? `<div class="dvs"><h4>${esc(T('value_per_domain'))}</h4>${vrows.map((r) => `<div class="dvr${r.index === d.index ? ' me' : ''}"><span class="nm">${b.html(r.name)}</span>`
    + `<span class="tr"><i style="width:${Math.max(3, (100 * r.amount) / vmax).toFixed(1)}%"></i></span><span class="am">${b.html(r.text)}</span></div>`).join('')}</div>` : '';
  const vblockH = vrows.length ? 14 + 14 + F.heading * 1.16 + 8 + vrows.length * 26 + 8 : 0;
  const overW = CW * 0.55 - 14;
  const bandH = 72 + 40 + F.numeral * 0.92 + F.label * 1.5 + 8 + textH(d.name, F.display, CW - 120, 1.16, { bold: true }) + (subtitle ? 8 + textH(subtitle, F.body, CW - 60) : 0) + 28;
  const statsH = 24 + F.heading * 1.15 + 6 + F.label * 2.6 + 18;
  const overH = 40 + F.heading * 1.16 + 8 + d.overview.reduce((a, p, i) => a + 8 + textH(p, F.lead, overW, 1.6), 0);
  const top = bandH + statsH + overH + 12 + F.heading * 1.16 + 14 + vblockH;
  const perPage = Math.max(1, Math.floor((ROOM + 72 - top - 8) / DC_MIN));
  const list = d.useCases;
  const chunks = []; for (let i = 0; i < list.length; i += perPage) chunks.push(list.slice(i, i + perPage));
  const nextPer = Math.max(1, Math.floor((ROOM - 70) / DC_MIN));
  if (chunks.length > 1) { const rest = list.slice(perPage); chunks.length = 1; for (let i = 0; i < rest.length; i += nextPer) chunks.push(rest.slice(i, i + nextPer)); }
  const first = { kind: 'domain', domain: d.index, section: d.index === 1 ? 'domains' : '', noHeader: true, room: ROOM, used: ROOM, parts: [
    `<section class="opener"${d.index === 1 ? ' id="sec-domains"' : ''}><div class="band">${artSvg('rings')}<div class="in">${wordmark('light')}<div class="num">${number}</div>`
    + `<div class="eyebrow">${esc(label)} ${number}</div><h2 id="domain-${d.index}">${b.html(d.name)}</h2>${subtitle ? `<div class="sub">${b.html(subtitle)}</div>` : ''}</div></div>`
    + `<div class="body"><table class="stats big domstats"><tr>${cells}</tr></table>`
    + `<div class="orow"><div class="overview txt"><h4>${esc(T('doc_domain_overview'))}</h4>${d.overview.map((p, i) => `<p class="${i ? '' : 'first'}"${b.dir(p)}>${b.text(p)}</p>`).join('')}</div>`
    + `${chips ? `<div class="cov"><h4>${esc(T('doc_what_it_covers'))}</h4><div class="chips">${chips}</div></div>` : ''}</div>`
    + `<h4 class="dch">${esc(T('doc_top_opportunities'))}</h4><div class="dcs">${chunks[0].map(dcard).join('')}</div>${vblock}</div></section>`] };
  const more = chunks.slice(1).map((c) => ({ kind: 'domain', domain: d.index, room: ROOM, used: ROOM, parts: [
    `<section class="opener cont"><div class="eyebrow">${esc(label)} ${number}</div><h2 class="title">${b.html(d.name)}</h2><div class="rule"></div><div class="dcs">${c.map(dcard).join('')}</div></section>`] }));
  return [first, ...more];
}

// C25: the value page. The total a year, the value per domain, the top use cases by value and the use cases without a value.
function valuePages(out, m, b) {
  const T = m.T; const v = m.value;
  const half = CW / 2 - 6 - 28;
  const stats = statsTable([[v.total.text, T('value_total')], [`${v.nWith} / ${m.total}`, T('value_with')], [String(v.byDomain.filter((d) => d.n).length), T('value_domains')]], b, 'big');
  const lead = T('value_lead', { with: v.nWith, total: m.total });
  const head = { html: `<div class="valpage" data-total-amount="${v.total.amount}" data-currency="${esc(v.total.currency)}"></div>${heading('value', T('value_kicker'), T('value_title')).html}<p class="lead">${esc(lead)}</p>${stats.html}`,
    h: heading('value', '', T('value_title')).h + textH(lead, F.lead, CW) + 12 + stats.h };
  const maxAmount = Math.max(1, ...v.byDomain.map((d) => d.amount));
  const bars = v.byDomain.map((d) => `<tr data-domain-amount="${d.amount}"><td class="nm">${b.html(d.name)}</td><td><div class="track"><div class="fill" style="width:${Math.max(d.amount ? 4 : 0, (100 * d.amount) / maxAmount).toFixed(1)}%"></div></div></td><td class="n">${b.html(d.amount ? d.text : '\u2013')}</td></tr>`).join('');
  const barsH = v.byDomain.reduce((a, d) => a + 7 + textH(d.name, F.small, CW * 0.34), 0);
  const blocks = [card(`<h4>${esc(T('value_per_domain'))}</h4><table class="bars vbars">${bars}</table>`, F.heading * 1.16 + 6 + barsH + 13, 'gap')];
  const cols = [['rank', T('doc_rank'), 0.07], ['id', 'ID', 0.1], ['title', T('usecase'), 0.37], ['domain', T('domain'), 0.16], ['amount', T('value_year'), 0.14], ['status', T('value_status'), 0.16]];
  const tableOf = (list, valued) => ({
    open: `<table class="index"><colgroup>${cols.map(([, , w]) => `<col style="width:${(100 * w).toFixed(1)}%"/>`).join('')}</colgroup><thead><tr>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}</tr></thead><tbody>`,
    close: '</tbody></table>', headH: F.label * 1.5 + 10,
    rows: list.map((u, i) => {
      const status = valued ? T(u.value.status === 'calculated' ? 'value_calculated_short' : 'value_estimated_short') : '';
      const cells = { rank: esc(valued ? i + 1 : u.rank), id: `<a>${esc(u.id)}</a>`, title: `<a>${b.html(u.title)}</a>`, domain: b.html(u.domain),
        amount: valued ? b.html(u.value.text) : '', status: valued ? esc(status) : esc(u.value.text) };
      return { html: `<tr>${cols.map(([k]) => `<td class="ix-${k}">${cells[k]}</td>`).join('')}</tr>`,
        h: 9 + Math.max(textH(u.title, F.small, CW * 0.37 - 12), textH(u.domain, F.small, CW * 0.16 - 12), textH(valued ? status : u.value.text, F.small, CW * 0.16 - 12)) };
    }),
  });
  if (v.top.length) { const t = tableHtml(tableOf(v.top, true)); blocks.push(card(`<h4>${esc(T('value_top'))}</h4>${t.html}`, F.heading * 1.16 + 6 + t.h + 13, 'gap')); }
  const notes = [];
  if (v.otherCurrency.length) notes.push(T('value_other_currency', { list: v.otherCurrency.join(', ') }));
  notes.push(T('value_note_body'));
  const after = notes.map((n) => ({ html: `<div class="vnote">${esc(n)}</div>`, h: 8 + textH(n, F.small, CW) }));
  if (!v.without.length) { flow(out, 'value', { head, blocks, after, extra: { section: 'value' } }); return; }
  const none = tableOf(v.without, false);
  flow(out, 'value', { head, blocks, extra: { section: 'value' },
    table: { t: none, wrap: (html) => `<div class="card gap"><h4>${esc(T('value_without'))}</h4>${html}</div>`, wrapH: 26 + 13 + F.heading * 1.16 + 6 }, after });
}

// _doc_art_svg: the rings and the network art of the cover, the openers and the closing page.
function artSvg(kind) {
  const white = `#${DOC_COLORS.white.toLowerCase()}`; const gold = `#${DOC_COLORS.gold.toLowerCase()}`;
  if (kind === 'rings') {
    const rings = [[470, 110, 150, 0.18], [470, 110, 110, 0.14], [470, 110, 70, 0.12], [350, 40, 120, 0.1], [560, 260, 140, 0.1], [300, 220, 60, 0.1], [520, 10, 50, 0.14]]
      .map(([cx, cy, r, op]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${white}" stroke-opacity="${op}" stroke-width="1.2"/>`).join('');
    return `<svg class="art" viewBox="0 0 560 560" xmlns="http://www.w3.org/2000/svg">${rings}<circle cx="505" cy="62" r="24" fill="${gold}" fill-opacity=".85"/></svg>`;
  }
  const nodes = [[30, 210], [90, 150], [150, 190], [210, 120], [270, 175], [330, 95], [390, 160], [450, 110], [510, 170], [570, 125], [630, 185], [690, 140], [750, 200], [120, 240], [240, 230], [360, 225], [480, 235], [600, 228], [720, 238]];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [1, 13], [2, 13], [4, 14], [3, 14], [6, 15], [5, 15], [8, 16], [7, 16], [10, 17], [9, 17], [12, 18], [11, 18]];
  const lines = edges.map(([a, c]) => `<line x1="${nodes[a][0]}" y1="${nodes[a][1]}" x2="${nodes[c][0]}" y2="${nodes[c][1]}" stroke="${white}" stroke-opacity=".16" stroke-width="1.4"/>`).join('');
  const dots = nodes.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i % 3 ? 5 : 7}" fill="${i % 5 === 0 ? gold : white}" fill-opacity="${i % 5 === 0 ? 0.75 : 0.28}"/>`).join('');
  const bars = [[20, 40], [70, 70], [120, 55], [170, 95], [220, 65], [270, 120], [320, 80], [370, 105], [420, 60], [470, 130], [520, 85], [570, 110], [620, 70], [670, 125], [720, 90]]
    .map(([x, h]) => `<rect x="${x}" y="${265 - h}" width="34" height="${h}" rx="4" fill="${white}" fill-opacity=".07"/>`).join('');
  return `<svg class="net" viewBox="0 0 780 265" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${bars}${lines}${dots}</svg>`;
}

// Every page as { kind, domain?, svg, used, room }: an A4 SVG holding the page's XHTML (foreignObject), drawn by the browser.
export function agentPdfPages(args) {
  const m = args.model || buildAgentModel(args);
  return pagesOf(m);
}
export function pagesOf(m) {
  const pages = sections(m);
  const css = agentPdfCss(m);
  const n = pages.length;
  const first = {};
  pages.forEach((p, i) => { if (p.section && !(p.section in first)) first[p.section] = i + 1; });
  const cls = ['ap', m.rtl ? 'rtl' : '', m.latinDisplay ? '' : 'nocaps'].filter(Boolean).join(' ');
  const dir = m.rtl ? 'rtl' : 'ltr';
  const pageNo = (i) => (m.rtl ? `\u200E${i} / ${n}\u200E` : `${i} / ${n}`);
  return pages.map((p, i) => {
    const body = p.parts.join('').replace(/@@PG:(\w+)@@/g, (_, k) => String(first[k] ?? ''));
    // C26: a text or table page that is short is drawn larger (the reader sees bigger type, not a half-empty page); height grows about with the square of the zoom.
    let page = body; let usedNow = p.used;
    if (!p.bleed && !p.grow && !['domain', 'cards', 'story'].includes(p.kind) && p.used < ROOM * 0.9) {
      const z = Math.min(p.kind === 'exec' ? 1.6 : ZOOM_MAX, Math.sqrt((ROOM * 0.94) / Math.max(p.used, 1)));
      page = `<div class="zoomed" style="zoom:${z.toFixed(3)}">${body}</div>`; usedNow = Math.min(ROOM, p.used * z * z);
    }
    const hdr = p.bleed || p.noHeader ? '' : `<div class="hdr">${wordmark()}<span${bidiFor(m).dir(m.businessName)}>${esc(m.businessName)}</span></div>`;
    const ftr = p.bleed ? '' : `<div class="ftr"><span${bidiFor(m).dir(m.generatedBy)}>${esc(m.generatedBy)}</span><span class="pno">${pageNo(i + 1)}</span></div>`;
    const classes = [cls, p.sand ? 'sand' : '', p.bleed ? 'bleed' : '', p.cls ? '' : ''].filter(Boolean).join(' ');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">`
      + `<div xmlns="http://www.w3.org/1999/xhtml" class="${classes}" dir="${dir}" lang="${esc(m.lang)}" data-kind="${p.kind}"><style>${css}</style>${hdr}<div class="content">${page}</div>${ftr}</div></foreignObject></svg>`;
    return { kind: p.kind, ...(p.domain ? { domain: p.domain } : {}), svg, used: Math.round(usedNow), room: p.room };
  });
}
export const agentPdfSvgs = (args) => agentPdfPages(args).map((p) => p.svg);

// The PDF file: each page drawn to a JPEG (RC7C-C-01: PNG pages made a 30 MB file the save route refuses with 413), one after the other
// to keep memory low, then jsPDF. rasterize is generateDocs.svgToPng (passed in, so this module stays free of the DOM and of a circular import).
export const PDF_RASTER = { scale: 1.25, type: 'image/jpeg', quality: 0.5 };
export async function buildAgentPdf(args, rasterize) {
  const images = [];
  for (const svg of agentPdfSvgs(args)) images.push(await rasterize(svg, PDF_RASTER.scale, { type: PDF_RASTER.type, quality: PDF_RASTER.quality }));
  const { pdfFromImages } = await import('./pdfDoc.js');
  return pdfFromImages(images);
}
