import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHELL_DIR = path.join(APP, 'agent', 'agent', 'app_shell');

export const KINDS_DEMO = {
  id: 'kinds-retail',
  title: 'Retail and supply chain',
  business: 'Retail and supply chain',
  summary: 'Use cases of every kind, each built as an MVP App you can open',
  sessionId: '2001',
  recordedAt: '2026-11-02T06:05:00.000Z',
};
export const DEMO_CATALOG = 'main.retail';
export const DEMO_OWNER = 'owner@example.com';
export const DEMO_RECORDED = 'Demo answer, recorded from the example data.';

const MONTHS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2025, 11 + i, 1)).toISOString().slice(0, 10));
const WEEKS = (n, from = Date.UTC(2026, 6, 6)) => Array.from({ length: n }, (_, i) => new Date(from + i * 7 * 86400000).toISOString().slice(0, 10));
const AS_OF = '2026-11-02';
const TIERS = ['Act now', 'Review', 'Monitor'];

const g = (q, a, sql = '') => ({ q, a, sql });

const DOMAINS = {
  N01: 'Customers and credit', N02: 'Procurement', N03: 'Replenishment', N04: 'Finance', N05: 'Supply chain', N06: 'Marketing',
  N07: 'Store performance', N08: 'Promotions', N09: 'Fulfillment', N10: 'Network and risk', N11: 'Analytics', N12: 'Finance reporting',
};

const curve = (start, step, wiggle = 0) => MONTHS.map((m, i) => [m, Math.round(start + i * step + (i % 3 === 1 ? wiggle : 0))]);
const DAYS = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 9, 4 + i)).toISOString().slice(0, 10));
const band = (expected, spikes) => DAYS.map((x, i) => {
  const mean = expected - (i % 7 >= 5 ? 4000 : 0);
  return [x, Math.round(mean * (spikes.includes(i) ? 1.3 + (i % 3) / 10 : 1 + ((i * 7) % 5 - 2) / 100)), mean, Math.round(mean * 0.9), Math.round(mean * 1.1)];
});

const DRAFTS = [
  {
    no: 'N01-U01', kind_num: 6, technique: 'Classification', name: 'Call the repeat buyers most likely to lapse this month',
    headline: 'Win Back Lapsing Repeat Buyers to Protect Margin', subdomain: 'Retention', sponsor: 'Head of CRM', beneficiary: 'CRM Team', cadence: 'Weekly', bob: 8.3,
    serve: 'A call list for the Head of CRM: every week, the repeat buyers most likely to stop buying, with the reasons and the value each one carries.',
    how: 'Classification: a model learns from past buyers who lapsed which patterns come first (longer gaps, smaller baskets, more returns) and scores every active buyer.',
    value: 'Margin kept from buyers who would have lapsed: buyers kept times yearly margin per buyer, from order_date, net_paid and returns.',
    story: '1,240 repeat buyers worth $3.1M a year look ready to lapse. Calling the top 200 this week reaches 41% of that value.',
    stake: '$3.1M a year', tables: ['store_sales', 'web_sales', 'customer', 'store_returns'], result: 'lapse_risk', app: 'lapse-desk', title: 'Lapse call list',
    genie: [
      g('Why is Buyer 10432 at 91%?', 'Three signals: the gap since the last order is 3 times this buyer\'s usual gap, the basket is 40% smaller than its 6-month average, and the last order had a return. Together they explain 78% of the score.', 'SELECT entity_id, score, tier, top_reasons, value_at_stake FROM lapse_risk WHERE entity_id = 10432'),
      g('How much more value do 300 calls reach than 200?', 'Working the top 300 reaches 52% of the lapse value, against 41% for 200: about $340K more a year for 100 more calls.', 'SELECT depth, captured_share, cost_at_cutoff FROM lapse_risk__lift WHERE depth IN (200, 300)'),
      g('Which reasons drive this week\'s Act now list?', 'The gap since the last order (34%) and smaller baskets (22%). Returns matter most for the top 50 buyers.', "SELECT reason, COUNT(*) AS buyers FROM lapse_risk LATERAL VIEW EXPLODE(top_reasons) r AS reason WHERE tier = 'Act now' GROUP BY reason ORDER BY buyers DESC"),
    ],
    mvp: {
      kpi_direction: 'decrease',
      kpis: [['Value at stake', 'currency', 3100000, 2800000], ['Buyers likely to lapse', 'percent', 4.6, 4.1], ['Buyers on the call list', 'integer', 1240, 1180]],
      trend: ['Value at stake by month', 'Value at stake', curve(2400000, 60000, 40000)],
      byCategory: ['Where the lapse value sits', 'Value at stake', [['Outerwear', 820000], ['Footwear', 640000], ['Kids', 520000], ['Camping', 430000], ['Bags', 380000], ['Home', 310000]]],
      mix: ['Lapse value by channel over time', ['Store', 'Web', 'App']],
      pareto: 'How concentrated the lapse value is',
      records: ['Call list', 'The 8 buyers most likely to lapse in the latest run, shown first from the 1,240 on the call list.', 'Buyer value'],
      filters: { category: ['Top category', ['Outerwear', 'Footwear', 'Kids', 'Camping', 'Bags', 'Home']], channel: ['Channel', ['Store', 'Web', 'App']], region: ['Region', ['North', 'South', 'East', 'West']] },
      rows: [
        ['Buyer 10432', 'Outerwear', 4200, 'Call this week with a loyalty offer', ['Gap since last order 3x usual', 'Basket down 40%']],
        ['Buyer 22871', 'Footwear', 3900, 'Call this week with a loyalty offer', ['Two returns in a month', 'No web visits']],
        ['Buyer 30019', 'Kids', 2600, 'Call this week', ['Stopped using the loyalty card']],
        ['Buyer 41107', 'Camping', 2100, 'Call this week', ['Gap since last order 2x usual']],
        ['Buyer 51220', 'Bags', 1800, 'Send a win-back email', ['Moved to discount items only']],
        ['Buyer 60391', 'Home', 1500, 'Send a win-back email', ['Basket down 25%']],
        ['Buyer 71554', 'Outerwear', 1300, 'Watch next week', ['Fewer store visits']],
        ['Buyer 80913', 'Footwear', 900, 'Watch next week', ['One return', 'Smaller baskets']],
      ],
    },
  },
  {
    no: 'N01-U04', kind_num: 36, technique: 'Survival Analysis', name: 'Call the overdue invoices most likely to slip past 90 days',
    headline: 'Collect Overdue Invoices Before They Pass 90 Days', subdomain: 'Collections', sponsor: 'Credit Manager', beneficiary: 'Collectors', cadence: 'Daily', bob: 7.9,
    serve: 'A daily call list for collectors: the overdue invoices most likely to slip past 90 days, with the cash each one holds.',
    how: 'Survival analysis: a time-to-pay model learns from paid invoices how payment speed depends on the customer\'s history, the invoice size and the terms, and gives each open invoice its chance of paying within 90 days.',
    value: 'Cash in sooner and fewer write-offs: cash at risk times the drop in late payment, from invoice_date, due_date, paid_date and amount.',
    story: '860 overdue invoices hold $1.9M that will likely slip past 90 days. 40 calls today reach 58% of it.',
    stake: '$1.9M of cash', tables: ['invoice', 'payment', 'customer'], result: 'late_payment_risk', app: 'collections-desk', title: 'Collections call list',
    genie: [
      g('Why is INV-20931 likely to slip?', 'This customer paid 4 of its last 5 invoices after 90 days, and this invoice is 3 times its usual size. Customers like this pay within 90 days 7% of the time.', "SELECT * FROM late_payment_risk WHERE entity_id = 'INV-20931'"),
      g('How much cash do 60 calls reach today?', 'The top 60 invoices hold 71% of the cash at risk ($1.35M), against 58% for 40 calls.', 'SELECT depth, captured_share FROM late_payment_risk__lift WHERE depth IN (40, 60)'),
      g('Which customers pay later every quarter?', '3 customers got slower 3 quarters in a row; together they hold $410K of open invoices.', 'SELECT customer, quarter, median_days_to_pay FROM late_payment_risk__history ORDER BY customer, quarter'),
    ],
    mvp: {
      kpi_direction: 'decrease',
      kpis: [['Cash at risk past 90 days', 'currency', 1900000, 1700000], ['Invoices likely to slip', 'percent', 7.4, 6.9], ['Overdue invoices', 'integer', 860, 812]],
      trend: ['Cash at risk by month', 'Cash at risk', curve(1300000, 50000, 30000)],
      byCategory: ['Where the cash at risk sits', 'Cash at risk', [['Wholesale', 640000], ['Franchise', 520000], ['Marketplace', 380000], ['Corporate', 240000], ['Other', 120000]]],
      mix: ['Cash at risk by terms over time', ['30 days', '60 days', '90 days']],
      pareto: 'How concentrated the cash at risk is',
      records: ['Collector call list', 'Overdue invoices from the latest run, most likely to slip first.', 'Cash held'],
      filters: { category: ['Customer type', ['Wholesale', 'Franchise', 'Marketplace', 'Corporate', 'Other']], channel: ['Terms', ['30 days', '60 days', '90 days']], region: ['Region', ['North', 'South', 'East', 'West']] },
      rows: [
        ['INV-20931', 'Wholesale', 88000, 'Call the finance contact today', ['Customer paid late 4 of the last 5', 'Invoice 3x usual size']],
        ['INV-20877', 'Franchise', 61000, 'Call today about the new terms', ['New terms, no payment yet']],
        ['INV-20512', 'Marketplace', 47000, 'Resolve the disputed line first', ['Disputed line open 20 days']],
        ['INV-20460', 'Wholesale', 33000, 'Call today', ['The customer\'s other invoices are also late']],
        ['INV-20391', 'Corporate', 21000, 'Send a reminder', ['Paid late last quarter']],
        ['INV-20318', 'Other', 18000, 'Send a reminder', ['Large invoice for this customer']],
      ],
    },
  },
  {
    no: 'N02-U02', kind_num: 24, technique: 'Controls Testing', name: 'Catch freight invoices billed above the contract rate',
    headline: 'Recover Freight Overbilling Before Invoices Are Paid', subdomain: 'Freight audit', sponsor: 'Accounts Payable Manager', beneficiary: 'Accounts Payable', cadence: 'Daily', bob: 8.1,
    serve: 'A daily exceptions queue for Accounts Payable: freight invoices billed above the contract rate, duplicated, or charged for more weight than was shipped, before they are paid.',
    how: 'Reconciliation and control tests: every invoice line is matched to its shipment and its contract rate. A line is flagged when the amount falls outside what the contract and the shipped weight allow, or when it repeats another invoice.',
    value: 'Overbilling recovered before payment: the billed amount above the contract amount, from freight_invoice, shipment and carrier_contract.',
    story: '37 freight invoices hold $412K billed above contract. 9 are new since yesterday and 4 have waited over 30 days.',
    stake: '$412K open', tables: ['freight_invoice', 'shipment', 'carrier_contract'], result: 'freight_exceptions', app: 'freight-exceptions', title: 'Freight exceptions',
    genie: [
      g('Why was INV-8812 flagged?', 'It bills $6,980 for a lane whose contract gives $4,120 for the 2.1 t shipped: 69% above. Carrier A\'s other invoices on this lane sit within 3% of contract.', "SELECT * FROM freight_exceptions WHERE entity_id = 'INV-8812'"),
      g('Is Carrier A overbilling more than last quarter?', 'Yes: 14 exceptions worth $231K this quarter against 5 worth $48K last quarter, all on 2 lanes since the rate change on Sep 1.', 'SELECT carrier, quarter, COUNT(*), SUM(exposure) FROM freight_exceptions__history GROUP BY carrier, quarter'),
      g('Which exceptions did we close as not an issue that look like these?', '6 were fuel surcharges approved by email. Because they were closed with "apply to similar", the next run skips that pattern.', "SELECT * FROM freight_exceptions__decisions WHERE decision = 'not_an_issue'"),
    ],
    mvp: {
      kpi: 'Billed above contract', kpi_direction: 'decrease',
      kpis: { open_n: [37, 28], exposure: [412000, 296000], anomalies: [9, 5], old_n: [4, 3] },
      signal: band(13700, [2, 5, 9, 12, 16, 19, 23, 26, 28]),
      rules: [['Rate above contract', 18], ['Duplicate invoice', 9], ['Weight above shipped', 6], ['Fuel surcharge above cap', 4]],
      ages: [['0 to 2 days', 9, 98000], ['3 to 7 days', 11, 141000], ['8 to 30 days', 13, 127000], ['30+ days', 4, 46000]],
      records: ['Exceptions queue', 'Open invoices from the latest run, the largest amount above contract first.'],
      filters: { region: ['Carrier', ['Carrier A', 'Carrier B', 'Carrier C', 'Carrier D']], segment: ['Lane', ['Inbound', 'Outbound', 'Store transfer']], channel: ['Mode', ['Road', 'Rail']] },
      rows: [
        ['INV-8812', 'Rate above contract', 2860, 1, 'Hold payment and dispute with Carrier A', ['Billed $6,980 against a $4,120 contract', 'Lane rate changed Sep 1'], 'Carrier A', 'Inbound', 'Road'],
        ['INV-8790', 'Duplicate invoice', 2300, 4, 'Reject as a duplicate', ['Same shipment billed twice'], 'Carrier C', 'Outbound', 'Road'],
        ['INV-8731', 'Rate above contract', 1170, 12, 'Hold payment and dispute', ['Billed $3,050 against a $1,880 contract'], 'Carrier A', 'Inbound', 'Rail'],
        ['INV-8702', 'Weight above shipped', 650, 18, 'Ask for the weight ticket', ['Billed weight 68% above shipped'], 'Carrier B', 'Store transfer', 'Road'],
        ['INV-8655', 'Fuel surcharge above cap', 310, 24, 'Pay the capped surcharge only', ['Surcharge above the contract cap'], 'Carrier D', 'Outbound', 'Road'],
        ['INV-8644', 'Rate above contract', 800, 41, 'Escalate: waiting over 30 days', ['Billed $4,100 against a $3,300 contract'], 'Carrier B', 'Inbound', 'Rail'],
      ],
    },
  },
  {
    no: 'N03-U01', kind_num: 5, technique: 'Forecasting', name: "Set next week's store orders from forecast demand",
    headline: 'Order to Forecast Demand to Cut Stockouts and Overstock', subdomain: 'Store ordering', sponsor: 'Head of Replenishment', beneficiary: 'Replenishment Planners', cadence: 'Weekly', bob: 8.4,
    serve: 'A forecast cockpit for replenishment: the coming weeks\' demand per item and store with its range, and the order to place, which planners accept or override.',
    how: 'Forecasting: one exponential smoothing model per series learns trend, weekly seasonality and holiday effects from 2 years of sales, and must beat a seasonal naive forecast before it is used.',
    value: 'Fewer stockouts and less overstock: lost margin avoided plus holding cost saved, from sales_qty, on_hand and unit_margin.',
    story: 'Demand rises 18% over the next 4 weeks. 14 store-items will run past shelf capacity unless orders change.',
    stake: '$2.4M a year', tables: ['store_sales', 'inventory', 'item', 'date_dim'], result: 'demand_forecast', app: 'store-orders', title: 'Store order cockpit',
    genie: [
      g('Why does Store 12 jump in week 48?', 'Week 48 holds the holiday weekend. Sales rose 34% and 31% that week in the last 2 years, and the model carries that effect forward.', "SELECT period, actual, forecast, lower, upper FROM demand_forecast__series WHERE series_id = 'store_12' AND period BETWEEN 44 AND 50"),
      g("How sure is next week's forecast for Store 31?", 'The 80% range is 9,100 to 10,400 units (plus or minus 7%). Store 31\'s error over the last 13 weeks was 6%, better than the 9% average.', "SELECT * FROM demand_forecast__series WHERE series_id = 'store_31' AND is_future LIMIT 1"),
      g('Which series did the model miss most last month?', 'Item 7781 at Store 12: it forecast 210 and sold 340, because a local event was not in the data. Planners overrode it twice, and both overrides were closer.', 'SELECT series_id, backtest_mase FROM demand_forecast__series GROUP BY 1,2 ORDER BY 2 DESC LIMIT 5'),
    ],
    mvp: {
      kpi: 'Store-items at risk of running out', kpi_direction: 'decrease',
      orders: [['Item 4471 at Store 12', 'Outerwear', 140, 620, 'Raise the order', ['Holiday weekend ahead', 'Demand up 18%']], ['Item 1209 at Store 31', 'Footwear', 380, 410, 'Raise the order a little', ['Demand rising']],
        ['Item 7781 at Store 12', 'Camping', 40, 300, 'Raise the order', ['Local event last year', 'Forecast range wide']], ['Item 3306 at Store 7', 'Bags', 210, 260, 'Raise the order a little', ['Demand rising']],
        ['Item 5120 at Store 44', 'Kids', 180, 150, 'Cut the order', ['Stock above forecast']], ['Item 2290 at Store 19', 'Home', 90, 80, 'Keep the order', ['On track']]],
      accuracy: [['Store 12', 0.62], ['Store 31', 0.71], ['Store 7', 0.84], ['Store 44', 1.06]],
    },
  },
  {
    no: 'N04-U02', kind_num: 16, technique: 'Simulation', name: "Test price and cost moves on next quarter's margin",
    headline: 'Plan Next Quarter Margin Against Price and Cost Moves', subdomain: 'Margin planning', sponsor: 'CFO', beneficiary: 'Finance Team', cadence: 'Monthly', bob: 7.6,
    serve: 'A scenario lab for the CFO: move price, cost and volume levers and see next quarter\'s margin with its range and the chance of hitting target, then save a plan of record.',
    how: 'Simulation: a driver model fitted on 3 years of sales links margin to each lever. 2,400 Monte Carlo scenarios give every lever combination a range instead of one number.',
    value: 'A better plan of record: the margin difference between the chosen plan and the base case, from net_paid, unit_cost, quantity and promotion cost.',
    story: 'At today\'s levers, margin lands at $4.20M with an 82% chance of the $4.0M target. Unit cost is the riskiest assumption.',
    stake: 'base $4.20M a quarter', tables: ['store_sales', 'item', 'promotion', 'date_dim'], result: 'margin_scenarios', app: 'margin-lab', title: 'Margin scenario lab',
    genie: [
      g('What has to be true to hit the $4.0M target?', 'From the 2,400 simulated scenarios: with price up 2% and unit cost flat, the chance is 91%. Volume matters less: each 1% adds about $40K.', 'SELECT price_pct, cost_pct, p50, prob_target FROM margin_scenarios__scenarios WHERE prob_target >= 0.9 ORDER BY ABS(price_pct) + ABS(cost_pct) LIMIT 5'),
      g('Which assumption is the riskiest?', 'Unit cost: its range moves margin by plus or minus $0.35M, more than any other lever, and it swung 6% a quarter over the last 3 years.', 'SELECT lever, low, high, delta FROM margin_scenarios__sensitivity ORDER BY delta DESC'),
      g('Compare the base and the downside cases', 'Downside (cost up 5%, volume down 3%) lands at $3.73M P50 with a 14% chance of target, against $4.20M and 82% for the base case.', "SELECT scenario_id, p10, p50, p90, prob_target FROM margin_scenarios__scenarios WHERE scenario_id IN ('base','downside')"),
    ],
    mvp: {
      kpi: 'Chance of the $4.0M margin target',
      base: 4200000, target: 4000000, sd: 220000,
      levers: [['price', 'Price change, %', 0.09], ['volume', 'Volume change, %', 0.04], ['unit_cost', 'Unit cost change, %', -0.07]],
      scenarios: [['base', 4200000, 3920000, 4480000, 82], ['upside', 4560000, 4270000, 4850000, 96], ['downside', 3730000, 3450000, 4010000, 14]],
      exposures: [
        ['Private-label snacks', 'North', 310000, 'Hold the 2% price rise on private-label snacks', ['Unit cost rose 6% last quarter', 'The largest margin swing under the cost lever']],
        ['Fresh produce', 'South', 240000, 'Agree next quarter\'s produce cost with the two main growers', ['Unit cost swung 9% a quarter over 3 years', 'The thinnest margin per unit']],
        ['Household cleaning', 'West', 180000, 'Cut the deepest promotion on household cleaning', ['Promotion cost rose 12%', 'Volume barely moved on promotion']],
        ['Frozen meals', 'East', 120000, 'Test a 1% price rise on frozen meals', ['Price adds the most margin here', 'Little price sensitivity in 3 years of sales']],
      ],
    },
  },
  {
    no: 'N05-U01', kind_num: 11, technique: 'Optimization', name: 'Rebalance stock between warehouses at the lowest cost',
    headline: 'Cut Freight and Holding Cost by Rebalancing Warehouse Stock', subdomain: 'Stock balancing', sponsor: 'Head of Supply', beneficiary: 'Supply Planners', cadence: 'Weekly', bob: 8.6,
    serve: 'A planner for the Head of Supply: each week it proposes which units to move between warehouses, and each line is accepted or overridden.',
    how: 'Optimization: a solver picks the moves that cover forecast demand at the lowest freight and holding cost, within warehouse capacity, truck slots and the weekly budget.',
    value: 'Fewer stockouts and less overstock: lost margin avoided plus holding cost saved, from on_hand, forecast_qty, unit_margin and freight_rate.',
    story: 'Moving 1,460 units between 3 warehouses saves $310K this week. W5 is almost full and limits the plan most.',
    stake: '$310K this week', tables: ['inventory_snapshot', 'warehouse', 'freight_rate', 'demand_forecast'], result: 'stock_rebalance', app: 'stock-rebalance', title: 'Stock rebalancing plan',
    genie: [
      g('What limits the plan most?', 'W5 capacity: one more unit of room is worth $12, and Tuesday truck slots are worth $640 each. Freight budget binds too, at $0.31 per extra dollar.', 'SELECT name, limit_value, used, slack, shadow_price FROM stock_rebalance__constraints ORDER BY shadow_price DESC'),
      g('What if W5 had 10% more room?', 'This needs a re-solve, because the plan changes with the limit. The price of W5\'s room ($12 a unit) suggests about $26K more saving.'),
      g("How much did last week's accepted lines save?", '31 of 34 lines were accepted; measured saving $268K against $290K planned. The 3 overrides saved $4K less than the plan would have.', "SELECT decision, SUM(saving_planned), SUM(saving_measured) FROM stock_rebalance__history WHERE week = '2026-W44' GROUP BY 1"),
    ],
    mvp: {
      objective: ['Saving vs the current plan', 310000], changed: 'Moves in the plan', binding: 'Limits that bind',
      lines: [['W1 to W4', 'Item 1209', 0, 300, 41200], ['W3 to W5', 'Item 7781', 40, 240, 22900], ['W2 to W5', 'Item 4471', 0, 120, 18400], ['W2 to W6', 'Item 3306', 0, 180, 9800],
        ['W3 to W6', 'Item 5120', 60, 220, 7400], ['W2 to W4', 'Item 2290', 0, 90, 3100], ['W1 to W5', 'Item 6610', 30, 60, 2600], ['W3 to W4', 'Item 9015', 0, 50, 1900]],
      limits: [['W5 capacity', 98, 100, 12], ['Tuesday truck slots', 100, 100, 640], ['Weekly freight budget', 96, 100, 0.31], ['W2 safety stock', 71, 100, 0], ['Lead time under 3 days', 64, 100, 0]],
      entity: 'Move', category: 'Item',
    },
  },
  {
    no: 'N05-U03', kind_num: 12, technique: 'Queueing', name: "Staff each store's checkouts to the forecast footfall",
    headline: 'Match Checkout Staffing to Footfall to Cut Labor Cost', subdomain: 'Store labor', sponsor: 'Store Operations Director', beneficiary: 'Store Managers', cadence: 'Weekly', bob: 7.8,
    serve: 'A staffing planner for store operations: next week\'s checkout shifts per store and hour, so the 90th-percentile wait stays under 5 minutes at the lowest labor cost.',
    how: 'Queueing and optimization: an Erlang C model turns forecast footfall into the staff needed per hour, and a solver builds shifts that meet it within the labor budget and the shift rules.',
    value: 'Lower labor cost at the same service: hours saved times hourly cost, plus sales kept from shorter waits, from footfall, transactions and labor_rate.',
    story: 'The plan cuts 410 checkout hours next week and keeps waits under 5 minutes in 96% of store-hours.',
    stake: '$38K this week', tables: ['footfall', 'store_sales', 'labor_rate', 'shift_rules'], result: 'checkout_staffing', app: 'checkout-staffing', title: 'Checkout staffing plan',
    genie: [
      g('Why add 2 staff at Store 12 on Saturday morning?', 'Forecast footfall is 1,180 an hour between 10 and 14, and with 3 staff the 90th-percentile wait would reach 9 minutes. 5 staff bring it to 4.2 minutes.', "SELECT * FROM checkout_staffing__plan WHERE store = 12 AND day = 'Sat'"),
      g('What limits the plan most?', 'The labor budget: each extra dollar would buy $1.10 of kept sales. The 8-hour shift cap binds on weekends.', 'SELECT * FROM checkout_staffing__constraints ORDER BY shadow_price DESC'),
      g('Where do waits still miss the target?', '4% of store-hours, mostly Store 31 on Sunday afternoons, where the budget runs out first.'),
    ],
    mvp: {
      objective: ['Labor saving', 38000], changed: 'Shifts changed', binding: 'Limits that bind',
      lines: [['Store 12, Tue 14 to 18', 'Checkout', 4, 2, 2100], ['Store 7, Mon 08 to 12', 'Checkout', 3, 2, 1400], ['Store 31, Wed 16 to 20', 'Checkout', 4, 3, 900],
        ['Store 31, Sun 12 to 16', 'Checkout', 3, 4, -600], ['Store 12, Sat 10 to 14', 'Checkout', 3, 5, -1200]],
      limits: [['Labor budget', 99, 100, 1.1], ['Max shift length 8 h', 100, 100, 0.8], ['Min 2 staff open hours', 80, 100, 0], ['Breaks per shift', 60, 100, 0]],
      entity: 'Store and hours', category: 'Role',
    },
  },
  {
    no: 'N06-U01', kind_num: 30, technique: 'Segmentation', name: 'Serve each customer group at a cost it can carry',
    headline: 'Align Service Cost With the Margin Each Segment Earns', subdomain: 'Customer value', sponsor: 'Head of Customer', beneficiary: 'Customer Team', cadence: 'Quarterly', bob: 8.0,
    serve: 'A segment explorer for the Head of Customer: buyers grouped by how they buy and what they cost to serve, with one treatment chosen per segment.',
    how: 'Clustering: k-means groups buyers on order frequency, basket size, returns, discount share and service contacts. Cost to serve is allocated per buyer from returns, shipping and contacts.',
    value: 'Margin from serving each segment at a cost it can carry: the cost-to-serve gap closed in the loss-making segments, from net_paid, returns, ship_cost and contacts.',
    story: 'Costly returners are 12% of buyers and lose 3% margin after returns and service. Loyal high value buyers earn 48% of margin.',
    stake: '$1.6M a year', tables: ['customer', 'store_sales', 'web_returns', 'service_contact'], result: 'buyer_segments', app: 'buyer-segments', title: 'Buyer segments',
    genie: [
      g('What makes Costly returners different?', 'They return 38% of what they buy against 9% on average, and contact service 4 times a year against once. Their baskets are average size.', "SELECT segment_id, profile FROM buyer_segments__segments WHERE label = 'Costly returners'"),
      g('Who moved from Loyal to Occasional since last quarter?', '312 buyers, mostly after a delivery delay over 5 days in September. 41% of them had a return refused.', "SELECT * FROM buyer_segments__migration WHERE from_segment = 'Loyal high value' AND to_segment = 'Occasional'"),
      g('Which segment costs most to serve per dollar of margin?', 'Costly returners: $1.31 of cost per dollar of margin, then Price hunters at $0.57.'),
    ],
    mvp: {
      kpi: 'Yearly margin per customer group',
      segments: [['S1', 'Loyal high value', 12, 48, 'Priority service', [9, 8, 2, 3, 4, 9]], ['S2', 'Growing', 18, 22, 'Standard service', [6, 6, 3, 4, 3, 6]],
        ['S3', 'Price hunters', 27, 14, 'Self-service only', [5, 4, 4, 9, 4, 3]], ['S4', 'Occasional', 31, 19, 'Standard service', [2, 5, 3, 5, 2, 4]],
        ['S5', 'Costly returners', 12, -3, 'Review returns policy', [5, 5, 9, 5, 9, 1]]],
      axes: ['Orders a year', 'Basket size', 'Return rate', 'Discount share', 'Service contacts', 'Margin'],
      treatments: ['Priority service', 'Standard service', 'Self-service only', 'Minimum order value', 'Review returns policy'],
      buyers: 41200, margin: 9800000,
    },
  },
  {
    no: 'N06-U04', kind_num: 31, technique: 'Recommendation', name: 'Pick the next product to offer each loyal buyer',
    headline: 'Raise Repeat Orders With the Next Best Product Offer', subdomain: 'Personalization', sponsor: 'Head of E-commerce', beneficiary: 'Campaign Team', cadence: 'Weekly', bob: 7.7,
    serve: 'An offer desk for e-commerce: the next 3 products to offer each loyal buyer, with the reason, sent to the weekly campaign.',
    how: 'Recommendation: item-to-item similarity learned from what buyers bought together and in sequence, checked against offering the most popular items to everyone.',
    value: 'Extra margin from offers that convert: offers sent times lift in conversion times margin per order, from web_sales, store_sales and item.',
    story: 'Offers beat the most-popular list by 1.8 times. 14% of the range is never offered and may be dead stock.',
    stake: '$900K a year', tables: ['web_sales', 'store_sales', 'item', 'customer'], result: 'next_offer', app: 'next-offer', title: 'Next offer desk',
    genie: [
      g('Why offer the trail jacket to Buyer 10432?', 'This buyer bought hiking boots and a backpack in the last 6 weeks. 41% of buyers with that pair buy a jacket within 2 months.', 'SELECT * FROM next_offer__recs WHERE entity_id = 10432 ORDER BY rank'),
      g('Which items are never offered?', '14% of the range, 610 items, mostly slow sellers in Camping. They may be dead stock rather than missed offers.'),
      g('Who should get the spring outerwear offer?', '6,400 loyal buyers have outerwear as their top offer; 2,100 of them bought outerwear last spring.'),
    ],
    mvp: {
      kpi: 'Margin from accepted offers',
      buyers: [['Buyer 10432', [['Trail jacket', 0.82, 'Bought hiking boots and a backpack; 41% of such buyers buy a jacket next'], ['Wool socks', 0.77, 'Bought boots 3 weeks ago'], ['Rain cover', 0.64, 'Bought a backpack, no cover']]],
        ['Buyer 22871', [['Kids raincoat', 0.79, 'Bought kids boots twice'], ['Lunch box', 0.66, 'School season, past buyer'], ['Water bottle', 0.58, 'Bought with lunch boxes 28% of the time']]],
        ['Buyer 30019', [['Running shoes', 0.74, 'Replaces every 9 months; last pair 10 months ago'], ['Sports watch', 0.61, 'Peers who run 3+ times a week'], ['Energy gels', 0.55, 'Bought with shoes 19% of the time']]]],
      categories: [['Outerwear', 1.9], ['Footwear', 2.1], ['Bags', 1.6], ['Camping', 1.4], ['Kids', 1.8]],
    },
  },
  {
    no: 'N07-U01', kind_num: 1, technique: 'Decomposition', name: 'Explain the margin gap to plan by price, volume and mix',
    headline: 'Close the Margin Gap to Plan by Fixing Its Drivers', subdomain: 'Variance to plan', sponsor: 'FP&A Lead', beneficiary: 'Regional Managers', cadence: 'Monthly', bob: 7.8,
    serve: 'A variance explainer for FP&A: why margin missed plan, split into price, volume, mix and cost, with an owner for every unit outside tolerance.',
    how: 'Decomposition: a price-volume-mix bridge splits the gap between plan and actual per region and category, and flags the units whose gap is outside the 3% tolerance.',
    value: 'Faster correction: margin recovered in the units that act on their driver, from net_paid, quantity, unit_cost and the plan table.',
    story: 'Margin missed plan by $400K (8.7% below). Volume in the North explains half of it.',
    stake: '$400K gap this month', tables: ['store_sales', 'item', 'store', 'margin_plan', 'store_comment'], result: 'margin_variance', app: 'margin-variance', title: 'Margin variance to plan',
    genie: [
      g('Why did volume fall in the North?', 'Units fell 11% in 9 North stores. 6 of them ran out of a top-20 item for 5 days or more, and their store comments mention late deliveries.', "SELECT unit, driver, variance FROM margin_variance__variance WHERE unit LIKE 'North%' AND driver = 'Volume'"),
      g('Which units are outside tolerance, and who owns them?', '6 of 24 units are outside 3%. 2 have owners: North Outerwear and West Kids. The other 4 have nobody yet.'),
      g('Summarize what store comments say about the miss', 'Late deliveries (31% of comments), a competitor\'s promotion (22%) and short staffing (14%). The late deliveries cluster in the North.'),
    ],
    mvp: {
      kpi: 'Gap to plan',
      labels: { actual: 'Margin', plan: 'Plan', variance: 'Gap to plan', outside_n: 'Units outside tolerance' },
      kpis: { actual: [4200000, 4450000], plan: [4600000, 4600000], variance: [-400000, -150000], outside_n: [6, 3] },
      walk: ['Plan to actual margin', ['Plan', 4600000], [['Volume', -210000], ['Price', -120000], ['Cost', -110000], ['Mix', 40000]], ['Actual', 4200000]],
      peers: ['Each unit against its plan', 'Plan', 'Actual', 'Below the line missed plan; the farther below, the larger the gap.'],
      gaps: ['Gap to plan by unit', 'Driver', 'Plan'],
      said: [
        ['North, Outerwear', 'Late deliveries', 'Two weeks of late deliveries left the top coats out of stock.', 'Regional manager, North'],
        ['West, Kids', 'Markdowns', 'We marked the school range down early to clear the old season.', 'Regional manager, West'],
        ['South, Camping', 'Supplier cost', 'The new tent supplier raised its unit cost from October.', 'Regional manager, South'],
      ],
      records: ['Units against plan', 'Region and category units from the latest month, the largest gap first. Tolerance is 3% of plan.'],
      filters: { region: ['Region', ['North', 'South', 'East', 'West']], segment: ['Category', ['Outerwear', 'Footwear', 'Kids', 'Camping', 'Bags']], channel: ['Driver', ['Volume', 'Price', 'Cost', 'Mix']] },
      rows: [
        ['North, Outerwear', 'Outerwear', -130000, 743000, 'Fix the late deliveries in the North', ['Units down 17.5% against plan', 'Store comments: late deliveries'], 'North', 'Volume'],
        ['North, Footwear', 'Footwear', -72000, 558000, 'Fix the late deliveries in the North', ['Units down 12.9% against plan'], 'North', 'Volume'],
        ['West, Kids', 'Kids', -30000, 330000, 'Review the kids markdowns', ['Price 9.1% under plan'], 'West', 'Price'],
        ['South, Camping', 'Camping', -24000, 289000, 'Check the new supplier cost', ['Unit cost 8.3% over plan'], 'South', 'Cost'],
        ['East, Bags', 'Bags', -14000, 212000, 'Review the bag promotions', ['Price 6.6% under plan'], 'East', 'Price'],
        ['North, Bags', 'Bags', -8000, 160000, 'Check the freight cost', ['Unit cost 5% over plan'], 'North', 'Cost'],
      ],
    },
  },
  {
    no: 'N07-U03', kind_num: 3, technique: 'Peer Benchmarking', name: 'Bring under-performing stores up to their peer group',
    headline: 'Lift Store Margin to the Peer Group Median', subdomain: 'Benchmarking', sponsor: 'Regional Director', beneficiary: 'Store Managers', cadence: 'Monthly', bob: 7.4,
    serve: 'A peer benchmark for regional directors: each store\'s margin against stores of the same size, format and catchment, with the gap in dollars and a practice to copy.',
    how: 'Peer benchmarking: a regression adjusts margin for store size, format and local income, so each store is compared with what its peers achieve, not with the average.',
    value: 'Margin from closing part of the gap to the peer median: gap times share closed, from store_sales, store and household_demographics.',
    story: '9 stores sit more than 2 points below their peer median, a gap worth $2.1M a year. Closing half of it adds $1.0M.',
    stake: '$2.1M a year', tables: ['store_sales', 'store', 'household_demographics'], result: 'store_peers', app: 'store-peers', title: 'Store peer benchmark',
    genie: [
      g('Why is Store 61 below its peers?', 'Its margin is 22.9% against a peer median of 29.8%. Most of the gap is markdowns: it marks down 3 weeks earlier than Store 44, the best peer of its size.'),
      g('What do the top stores in this peer group do differently?', 'They mark down later, hold 12% less slow stock and carry 2 more high-margin lines per category.'),
      g('Which gaps are worth the most?', 'Store 61 ($410K), Store 27 ($350K) and Store 19 ($280K) hold half of the $2.1M gap.'),
    ],
    mvp: {
      kpi: 'Gap to peers, a year', kpi_direction: 'decrease',
      labels: { actual: 'Margin, a year', plan: 'Peer median, a year', variance: 'Gap to peers', outside_n: 'Stores below peers' },
      kpis: { actual: [12500000, 12300000], plan: [14600000, 14600000], variance: [-2100000, -2300000], outside_n: [9, 11] },
      walk: ['Peer median to actual margin', ['Peer median', 14600000], [['Markdowns', -900000], ['Mix', -520000], ['Shrink', -410000], ['Staff hours', -270000]], ['Actual', 12500000]],
      peers: ['Each store against its peer median', 'Peer median', 'This store', 'Above the line beats its peers; below it trails them.'],
      gaps: ['Gap to the peer median', 'Cause', 'Peer median'],
      said: [
        ['Store 61', 'Markdowns', 'We start markdowns in week 6 of the season; Store 44 waits until week 9.', 'Store manager, Store 61'],
        ['Store 27', 'Range', 'Two high-margin lines were dropped when the shelf plan changed.', 'Store manager, Store 27'],
        ['Store 19', 'Returns', 'Returns without a receipt doubled after the policy change.', 'Store manager, Store 19'],
      ],
      records: ['Stores below their peers', 'Stores from the latest run, the largest gap in dollars first. Tolerance is 3% of the peer median.'],
      filters: { region: ['Region', ['North', 'South', 'East', 'West']], segment: ['Peer group', ['Mid-size urban', 'Large urban', 'Small suburban', 'Rural']], channel: ['Cause', ['Markdowns', 'Shrink', 'Staff hours', 'Mix']] },
      rows: [
        ['Store 61', 'Mid-size urban', -410000, 1790000, 'Copy Store 44 markdown timing', ['Margin 22.9% against a peer median of 29.8%'], 'North', 'Markdowns'],
        ['Store 27', 'Large urban', -350000, 2260000, 'Add high-margin lines', ['Margin 26.2% against 31%', 'Fewer high-margin lines'], 'West', 'Mix'],
        ['Store 19', 'Mid-size urban', -280000, 1600000, 'Tighten the returns check', ['Margin 24% against 29.1%', 'Returns above peers'], 'South', 'Shrink'],
        ['Store 52', 'Large urban', -260000, 2100000, 'Copy Store 44 markdown timing', ['Markdowns 3 weeks earlier than peers'], 'East', 'Markdowns'],
        ['Store 14', 'Small suburban', -230000, 1150000, 'Add high-margin lines', ['Two fewer high-margin lines than peers'], 'North', 'Mix'],
        ['Store 40', 'Rural', -190000, 960000, 'Copy the peer markdown timing', ['Markdowns deeper than peers'], 'South', 'Markdowns'],
        ['Store 8', 'Small suburban', -160000, 1080000, 'Tighten the returns check', ['Shrink 1.1 points above peers'], 'West', 'Shrink'],
        ['Store 45', 'Rural', -130000, 890000, 'Match the peer staff hours', ['Staff hours 9% above peers'], 'East', 'Staff hours'],
        ['Store 7', 'Small suburban', -90000, 1010000, 'Match the peer staff hours', ['Margin 25.1% against 28%', 'Staff hours above peers'], 'East', 'Staff hours'],
      ],
    },
  },
  {
    no: 'N08-U01', kind_num: 19, technique: 'Causal Impact', name: 'Keep, change or stop each promotion by its true net lift',
    headline: 'Move Promotion Spend to Promotions With Real Lift', subdomain: 'Promotion review', sponsor: 'Head of Promotions', beneficiary: 'Promotion Planners', cadence: 'After each promotion', bob: 8.2,
    serve: 'A lift readout for promotions: what each promotion really added after cannibalization and pull-forward, with a keep, change or stop call.',
    how: 'Causal impact: difference-in-differences compares stores with the promotion against matched stores without it, with the 12 weeks before as the baseline.',
    value: 'Promotion spend moved from loss-making to profitable promotions: net lift minus cost per promotion, from store_sales, promotion and item.',
    story: '$2.8M of promotion spend reviewed a year: Spring 2-for-1 added $212K net, and clearance week lost $35K after cannibalization.',
    stake: '$2.8M spend reviewed a year', tables: ['store_sales', 'promotion', 'item', 'store'], result: 'promo_lift', app: 'promo-lift', title: 'Promotion lift readout',
    genie: [
      g('Is the Spring 2-for-1 lift real or just the season?', 'Real: matched stores without the promotion rose 4% in the same weeks, the promoted stores rose 19%. The 95% range of the net lift is $140K to $280K.', "SELECT * FROM promo_lift__effect WHERE intervention = 'Spring 2-for-1'"),
      g('Which promotions lose money after cannibalization?', 'Clearance week: $1.1M of extra sales, but $0.6M was taken from full-price items and $0.2M pulled from the next weeks. Net loss $35K.'),
      g('What should we test next?', 'Loyalty 15% off: its range crosses zero. A 4-week test in 20 stores with 20 matched stores would settle it.'),
    ],
    mvp: {
      kpi: 'Net lift per promotion',
      promos: [['Spring 2-for-1', 212000, 140000, 280000, 19, 0.01, 230, 'Scale it: strong net lift', 92000], ['Back-to-school bundle', 96000, 40000, 150000, 9, 0.02, 180, 'Keep it as it is', 53000],
        ['Loyalty 15% off', 64000, -10000, 138000, 5, 0.09, 120, 'Not sure yet: test again', 53000], ['Clearance week', -35000, -80000, 8000, -3, 0.12, 60, 'Stop it: no real lift', 58000]],
    },
  },
  {
    no: 'N09-U01', kind_num: 34, technique: 'Process Mining', name: 'Cut order-to-ship delays at the slowest warehouses',
    headline: 'Ship Orders on Time by Removing Fulfillment Bottlenecks', subdomain: 'Order flow', sponsor: 'Head of Fulfillment', beneficiary: 'Warehouse Leads', cadence: 'Weekly', bob: 7.9,
    serve: 'A process view for fulfillment: how orders really flow from placed to shipped, where they wait, and which open orders will miss the promised date.',
    how: 'Process mining: the order status timestamps form an event log. Inspire rebuilds each order\'s path, measures the wait between steps and scores open orders for the risk of missing their date.',
    value: 'Fewer late shipments: late orders avoided times the cost of a late order (refunds, lost repeat), from order_status_history and orders.',
    story: 'Orders wait 14.6 hours for a shipping label at W5, the longest step. 412 open orders may miss their date.',
    stake: '$700K a year', tables: ['order_status_history', 'orders', 'warehouse'], result: 'order_flow', app: 'order-flow', title: 'Order flow',
    genie: [
      g('Where do orders wait longest?', 'Between Packed and Label printed at W5: 14.6 hours median, against 2.3 hours at W2. Labels print in 2 batches a day there.', 'SELECT from_step, to_step, median_hours, p90_hours FROM order_flow__transitions ORDER BY median_hours DESC LIMIT 3'),
      g('What do slow orders have in common?', '62% are split shipments or need an address fix. Split shipments take 55 hours at the median against 31 for the happy path.'),
      g('How much faster is the happy path?', '31 hours median against 46 hours for orders that get repacked.'),
    ],
    mvp: {
      kpi: 'Orders that may miss the promised date', kpi_direction: 'decrease',
      kpis: { open: 4120, at_risk: 412, age: 31 },
      moves: [['Placed', 'Picked', 4120, 3.1, 7], ['Picked', 'Packed', 3980, 5.2, 12], ['Packed', 'Label printed', 3900, 14.6, 29], ['Label printed', 'Shipped', 3850, 8, 17],
        ['Packed', 'Picked', 310, 4.4, 10], ['Picked', 'Address fix', 190, 6, 14], ['Address fix', 'Packed', 185, 9.5, 21]],
      rework: [['Picked', 310], ['Address fix', 190], ['Label printed', 40]],
      cycle: [['Happy path', 12, 22, 31, 40, 58], ['With repack', 18, 32, 46, 60, 84], ['Split shipment', 20, 40, 55, 71, 102], ['Address fix', 16, 34, 49, 66, 95]],
      rows: [
        ['ORD-77120', 'Label printed', 19.5, 91, 'Print the label in the next batch', ['Waiting 19.5 hours for a label', 'Breach risk 91%'], 'Split shipment', 'W5'],
        ['ORD-77088', 'Label printed', 17.2, 86, 'Print the label in the next batch', ['Waiting 17.2 hours for a label', 'Breach risk 86%'], 'Happy path', 'W5'],
        ['ORD-77141', 'Label printed', 15.8, 80, 'Print the label in the next batch', ['Waiting 15.8 hours for a label'], 'With repack', 'W5'],
        ['ORD-76990', 'Picked', 11, 74, 'Move it to the packing queue', ['Waiting 11 hours after picking', 'Breach risk 74%'], 'Address fix', 'W2'],
        ['ORD-77002', 'Packed', 9.4, 66, 'Check the address before it waits again', ['Waiting 9.4 hours after packing'], 'Address fix', 'W6'],
        ['ORD-76951', 'Picked', 8.1, 61, 'Move it to the packing queue', ['Waiting 8.1 hours after picking'], 'Split shipment', 'W2'],
      ],
    },
  },
  {
    no: 'N10-U01', kind_num: 13, technique: 'Geospatial Analysis', name: 'Choose the next five store sites by unmet demand',
    headline: 'Grow Sales With the Right Next Store Sites', subdomain: 'Expansion', sponsor: 'Head of Expansion', beneficiary: 'Real Estate Team', cadence: 'Quarterly', bob: 7.7,
    serve: 'A site map for expansion: candidate locations ranked by unmet demand nearby, net of the sales they would take from current stores.',
    how: 'Geospatial analysis and optimization: demand is estimated around each candidate from buyers\' home locations, and a solver picks the 5 sites that add the most net demand together.',
    value: 'Sales from the right next stores: net new demand of the chosen sites, from customer_address, store and store_sales.',
    story: '5 sites add $6.8M a year net. Site S3 looks strong alone but takes 22% from Store 12.',
    stake: '$6.8M a year', tables: ['customer_address', 'store', 'store_sales'], result: 'site_ranking', app: 'site-ranking', title: 'Next store sites',
    genie: [
      g('Why is S1 ranked above S3?', 'S3 has more demand nearby, but 22% of it would come from Store 12, so it nets $1.9M against $2.1M for S1. S1 takes 4% from existing stores.'),
      g('Which areas are underserved?', 'The north-west: 310,000 buyers live more than 20 minutes from a store, and they order online 2.1 times more than buyers near a store.'),
      g('What if we open only 3 sites?', 'This needs a re-solve. The best 3 would likely be S1, S2 and S4, worth about $5.0M a year.'),
    ],
    mvp: {
      kpi: 'Unmet demand a year',
      sites: [
        ['S1', 'Leeds North', 'GB', 53.83, -1.55, 2100000, 'Shortlist it: open first', ['Unmet demand nearby', 'Takes 4% from current stores'], 'Large'],
        ['S3', 'Bristol East', 'GB', 51.46, -2.55, 1900000, 'Shortlist it, but check Store 12', ['Strong demand', 'Takes 22% from Store 12'], 'Mid-size'],
        ['S2', 'Manchester West', 'GB', 53.48, -2.3, 1700000, 'Shortlist it', ['Unmet demand nearby', 'Takes 6% from current stores'], 'Mid-size'],
        ['S4', 'Dublin South', 'IE', 53.3, -6.26, 1200000, 'Shortlist it', ['Takes 3% from current stores'], 'Small'],
        ['S5', 'Utrecht Centre', 'NL', 52.09, 5.12, 1000000, 'Shortlist it', ['Takes 8% from current stores'], 'Small'],
        ['S6', 'Antwerp North', 'BE', 51.24, 4.4, 800000, 'Reject it: lower demand nearby', ['Lower demand nearby'], 'Small'],
        ['S7', 'Cologne East', 'DE', 50.94, 7.01, 700000, 'Reject it: takes too much from current stores', ['Takes 12% from current stores'], 'Small'],
      ],
    },
  },
  {
    no: 'N10-U03', kind_num: 27, technique: 'Network Analysis', name: 'Break up return-abuse rings across accounts',
    headline: 'Stop Refund Abuse by Coordinated Account Rings', subdomain: 'Loss prevention', sponsor: 'Head of Loss Prevention', beneficiary: 'Loss Prevention Analysts', cadence: 'Weekly', bob: 8.0,
    serve: 'A network view for loss prevention: groups of accounts linked by shared cards, addresses or devices that return far more than normal.',
    how: 'Network analysis: accounts become nodes, shared attributes become links, and community detection finds tight groups whose return pattern stands out.',
    value: 'Refund abuse stopped: refunds in confirmed rings, from store_returns, customer and payment details.',
    story: '11 rings link 74 accounts with $186K of refunds. 2 rings are new this week.',
    stake: '$186K exposure', tables: ['store_returns', 'customer', 'payment_method', 'device'], result: 'return_rings', app: 'return-rings', title: 'Return rings',
    genie: [
      g('What links the accounts in R-07?', '4 accounts share one card and 3 share one address. Together they returned $48K in 6 weeks, 11 times the normal rate for accounts of their age.'),
      g('Which rings grew since last week?', 'R-07 added 2 accounts and R-11 is new. Both use the same 2 addresses.'),
      g('How many flagged rings were confirmed?', 'Of 14 rings decided so far, 11 were blocked after review and 3 were families sharing a card.'),
    ],
    mvp: {
      kpi: 'Accounts central to a ring', kpi_direction: 'decrease',
      kpis: { accounts: 74, rings: 11, central: 9 },
      accounts: [
        ['C-1042', 'R-07', 0.92, 48000, 'Block the account: it shares a card with 3 others', ['Same card x4', 'Same address x3']],
        ['C-2210', 'R-07', 0.81, 31000, 'Block the account: it shares a card with 3 others', ['Same card x4']],
        ['C-0877', 'R-03', 0.77, 39000, 'Investigate the returns first', ['Same device x5']],
        ['C-3391', 'R-11', 0.71, 27000, 'Investigate the returns first', ['Same address x4', 'New ring']],
        ['C-1188', 'R-07', 0.64, 22000, 'Investigate the returns first', ['Same address x3']],
        ['C-4120', 'R-03', 0.58, 18000, 'Not a ring: a family sharing a device', ['Same device x2']],
        ['C-2675', 'R-11', 0.52, 16000, 'Investigate the returns first', ['Same address x4']],
        ['C-0931', 'R-05', 0.47, 18000, 'Watch it next week', ['Same card x3']],
        ['C-3007', 'R-05', 0.41, 12000, 'Watch it next week', ['Same card x3']],
        ['C-1564', 'R-03', 0.36, 9000, 'Not a ring: a family sharing a device', ['Same device x2']],
      ],
      links: [['C-1042', 'C-2210', 12], ['C-1042', 'C-1188', 9], ['C-2210', 'C-1188', 7], ['C-0877', 'C-4120', 8], ['C-0877', 'C-1564', 6], ['C-4120', 'C-1564', 4],
        ['C-3391', 'C-2675', 10], ['C-0931', 'C-3007', 7], ['C-1188', 'C-3391', 3]],
    },
  },
  {
    no: 'N11-U01', kind_num: 40, technique: 'Data Agent', name: 'Answer any sales and stock question with the SQL behind it',
    headline: 'Answer Commercial Data Questions in Plain Words', subdomain: 'Self-service', sponsor: 'Head of Commercial', beneficiary: 'Commercial Teams', cadence: 'On demand', bob: 7.2,
    serve: 'A data agent for commercial teams: ask the sales and stock data anything in plain words and get the answer with the SQL it ran.',
    how: 'Genie answers from a room built on the sales and stock tables, with checked example questions. ai_query writes the short summaries.',
    value: 'Hours saved on ad hoc requests: questions answered times analyst time per request, from the room\'s question log.',
    story: '312 questions answered this week. 18 of 20 benchmark questions answered right.',
    stake: '18 of 20 benchmark answers right', tables: ['store_sales', 'web_sales', 'inventory', 'item', 'store'], result: 'data_questions', app: 'data-questions', title: 'Sales and stock questions',
    genie: [
      g('Which 5 items lost the most margin last month?', 'Item 7781 ($41K less), Item 3306 ($28K less), Item 1209 ($22K less), Item 5120 ($19K less) and Item 2290 ($12K less). All 5 had markdowns over 30%.', "SELECT i_item_id, SUM(ss_net_profit) AS margin FROM store_sales JOIN item USING (i_item_sk) WHERE d_month = '2026-10' GROUP BY 1 ORDER BY 2 LIMIT 5"),
      g('How much stock is older than 90 days?', '$3.4M at cost, 11% of stock. Camping holds 38% of it.', 'SELECT category, SUM(cost) FROM inventory WHERE age_days > 90 GROUP BY category'),
      g('Compare web and store sales growth this quarter', 'Web grew 9% and stores 2%. Web grows fastest in Kids, up 21%.'),
      g('Which stores sold out of the top 20 items most often?', 'Store 12 (31 sell-outs), Store 4 (24) and Store 31 (19). All 3 order on Mondays, before the weekend peak.'),
      g('What share of sales came from promotions last month?', '27% of sales, up from 22% a year ago. Grocery is the most promoted category at 41%.'),
    ],
    mvp: {
      kpi: 'Net sales this quarter',
      kpis: { rows: 1840000, accounts: 9400, net: 48200000 },
      filters: { region: ['Region', ['North', 'South', 'East', 'West']], account: ['Store', ['Store 4', 'Store 12', 'Store 31']], cost_center: ['Category', ['Camping', 'Kids', 'Home', 'Grocery']] },
    },
  },
  {
    no: 'N12-U01', kind_num: 2, technique: 'Decomposition', name: "Split this month's margin change into price, volume and mix",
    headline: 'Show Monthly Margin Movement by Price, Volume and Mix', subdomain: 'Monthly margin', sponsor: 'Finance Business Partner', beneficiary: 'Finance Team', cadence: 'Monthly', bob: 7.6,
    serve: 'A monthly dashboard for finance: how much of the change in margin came from price, volume, mix and cost, by region and category.',
    how: 'A price-volume-mix bridge: the change in margin is split into what price, units sold, the mix of items and unit cost each contributed, line by line.',
    value: 'Faster, shared answers to "why did margin move": the bridge from store_sales, item and item_cost.',
    story: 'Margin fell $0.40M this month. Volume took $0.21M and price $0.12M; mix added $0.04M.',
    stake: '$0.40M moved this month', tables: ['store_sales', 'item', 'item_cost'], result: 'margin_bridge', app: 'margin-bridge', title: 'Margin bridge',
    genie: [
      g('Which region moved most?', 'The North: $130K less from volume and $41K less from price. Its 2 late-delivery weeks match the drop.', 'SELECT region, SUM(volume_effect), SUM(price_effect) FROM margin_bridge__bridge GROUP BY region'),
      g('Is the price effect from markdowns?', 'Mostly: $91K of the $120K comes from apparel markdowns started in week 44.'),
      g('How does this month compare with last year?', 'Last November margin fell $0.22M, almost all from volume. Price was flat.'),
    ],
    mvp: {
      kpi: 'Margin this month',
      labels: { revenue: 'Margin this month', prior: 'Margin last month', growth: 'Change on last month' },
      kpis: { revenue: [4200000, 4600000], prior: [4600000], growth: [-8.7] },
      trend: ['Margin by month', curve(4500000, -8000, 60000), curve(4300000, -2000, 40000)],
      byRegion: [['North', 1050000, 1220000], ['East', 1100000, 1180000], ['South', 1000000, 1060000], ['West', 1050000, 1140000]],
      filters: { region: ['Region', ['North', 'South', 'East', 'West']], segment: ['Category', ['Footwear', 'Outerwear', 'Camping', 'Apparel']], channel: ['Driver', ['Volume', 'Price', 'Mix', 'Cost']] },
      rows: [
        ['North, Apparel', 'North', 'Apparel', 'Volume', -130000, 610000],
        ['East, Apparel', 'East', 'Apparel', 'Price', -91000, 540000],
        ['South, Camping', 'South', 'Camping', 'Cost', -40000, 330000],
        ['West, Footwear', 'West', 'Footwear', 'Mix', 38000, 420000],
        ['North, Outerwear', 'North', 'Outerwear', 'Mix', 21000, 390000],
      ],
    },
  },
];
const KINDS = JSON.parse(fs.readFileSync(path.join(SHELL_DIR, 'kinds.json'), 'utf8')).kinds;
function withKind({ kind_num, ...u }) {
  const kind = KINDS.find((k) => k.num === kind_num);
  if (!kind) throw new Error(`kinds.json has no kind ${kind_num} for ${u.no}`);
  return { no: u.no, kind: kind.id, ...u, mvp: { layout: kind.layout, ...u.mvp } };
}
export const USE_CASES = DRAFTS.map(withKind);

const fq = (table) => `${DEMO_CATALOG}.${table}`;
const priorityOf = (bob) => (bob >= 8 ? 'Very High' : 'High');

export function inspireUseCase(u, rank) {
  return {
    No: u.no, Name: u.name, usecase: u.headline, 'Analytics Technique': u.technique, use_case_kind: u.kind,
    'Business Domain': DOMAINS[u.no.slice(0, 3)], Subdomain: u.subdomain, Beneficiary: u.beneficiary, Sponsor: u.sponsor,
    Priority: priorityOf(u.bob), Quality: priorityOf(u.bob), 'Priority Score': u.bob, 'Quality Score': Number((u.bob / 2).toFixed(2)), 'Inspire Score': u.bob,
    bob_score: u.bob, best_of_best: 'Y', best_of_best_rank: String(rank), selection_basis: 'earned', 'Decision Cadence': u.cadence,
    Statement: u.story, Solution: `${u.serve} ${u.how}`, 'Business Value': `${u.value} At stake: ${u.stake}.`,
    serving_summary: u.serve, method_summary: u.how, value_source: u.value,
    KPIs: [{ name: u.mvp.kpi || (Array.isArray(u.mvp.kpis) ? u.mvp.kpis[0][0] : u.mvp.objective[0]), direction: u.mvp.kpi_direction || 'increase' }],
    'Tables Involved': u.tables.map(fq).join(', '), 'Primary Table': fq(u.tables[0]), has_genie_code: 'Y',
  };
}

export function rankedUseCases() {
  const order = [...USE_CASES].sort((a, b) => b.bob - a.bob || a.no.localeCompare(b.no));
  return USE_CASES.map((u) => inspireUseCase(u, order.indexOf(u) + 1));
}

export const exampleFile = (layout) => path.join(SHELL_DIR, layout === 'decision_queue' ? 'example_page.json' : path.join('examples', `${layout}.json`));
function exampleOf(u) {
  const text = fs.readFileSync(exampleFile(u.mvp.layout), 'utf8');
  const result = JSON.parse(text).result_table || 'main.pricing.loss_desk_out';
  return JSON.parse(text.split(result).join(`${DEMO_CATALOG}.${u.result}`).replace(/\bmain\.(pricing|supply|marketing|sales|finance)\./g, `${DEMO_CATALOG}.`));
}
const byId = (list, changes) => list.map((item) => ({ ...item, ...(changes[item.id] || {}) }));
const yLabels = (chart, labels) => ({ y: chart.y.map((y, i) => ({ ...y, label: labels[i] ?? y.label })) });
const pageIdOf = (u) => u.no.toLowerCase().replace('-', '_');

function filterText(spec, labels) {
  return spec.filters.map((f) => (labels[f.id] ? { ...f, label: labels[f.id][0] } : f));
}

function base(u, spec) {
  return {
    id: pageIdOf(u), use_case_id: u.no, title: u.title, question: u.name,
    sponsor: u.sponsor, domain: DOMAINS[u.no.slice(0, 3)], subdomain: u.subdomain, questions: u.genie.map((x) => x.q),
    result_table: `${DEMO_CATALOG}.${u.result}`,
  };
}

function decisionPage(u, spec) {
  const m = u.mvp;
  const [k1, k2, k3] = m.kpis;
  const charts = Object.fromEntries(spec.charts.map((c) => [c.id, c]));
  return {
    ...base(u, spec),
    story: `${u.story} The list holds {items} rows, {items:change} on the previous run.`,
    kpis: byId(spec.kpis, {
      total_loss: { label: k1[0], format: k1[1], good: 'neutral' }, loss_rate: { label: k2[0], format: k2[1], good: 'neutral' }, items: { label: k3[0], format: k3[1], good: 'neutral' },
    }),
    charts: byId(spec.charts, {
      loss_trend: { title: m.trend[0], hint: `${m.trend[1]} in each month of the last year.`, so_what: u.story, ...yLabels(charts.loss_trend, [m.trend[1]]) },
      by_category: { title: m.byCategory[0], hint: `${m.byCategory[1]} by ${m.filters.category[0].toLowerCase()}.`, so_what: `Start with the ${m.filters.category[0].toLowerCase()} at the top.`,
        ...yLabels(charts.by_category, [m.byCategory[1]]), x: { ...charts.by_category.x, label: m.filters.category[0] } },
      channel_mix: { title: m.mix[0], hint: `${m.trend[1]} split by ${m.filters.channel[0].toLowerCase()}.`, so_what: 'A growing band is where to look next.', ...yLabels(charts.channel_mix, [m.trend[1]]) },
      pareto: { title: m.pareto, hint: 'The share of the total that the largest groups hold.', so_what: 'The first few groups hold most of it, so work them first.', ...yLabels(charts.pareto, [m.byCategory[1]]),
        x: { ...charts.pareto.x, label: m.filters.category[0] } },
    }),
    records: {
      ...spec.records, title: m.records[0], hint: m.records[1],
      detail: [{ column: 'value', label: m.records[2], format: k1[1] === 'currency' ? 'currency' : 'number', ...(k1[1] === 'currency' ? { currency: 'USD' } : {}) },
        { column: 'channel', label: m.filters.channel[0], format: 'text' }, { column: 'region', label: m.filters.region[0], format: 'text' }],
      columns: [{ column: 'category', label: m.filters.category[0] }, { column: 'value', label: m.records[2] }].map((c, i) => ({ ...spec.records.columns[i], ...c })),
    },
    filters: filterText(spec, m.filters),
  };
}

function decisionRows(u) {
  const m = u.mvp;
  return m.rows.map(([label, category, value, action, reasons, channel, region], i) => ({
    record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(100 + i), entity_id: label, entity_label: label, category,
    channel: channel || m.filters.channel[1][i % m.filters.channel[1].length], region: region || m.filters.region[1][i % m.filters.region[1].length],
    priority_tier: TIERS[Math.min(2, Math.floor((i * 3) / m.rows.length))], rank: i + 1, value, recommended_action: action, top_reasons: reasons, as_of_date: AS_OF,
  }));
}

function decisionData(u, picked) {
  const m = u.mvp;
  const cats = m.byCategory[2].filter(([c]) => !picked?.category?.length || picked.category.includes(c));
  const scale = cats.length / m.byCategory[2].length || 0;
  const series = m.mix[1];
  const total = cats.reduce((s, [, v]) => s + v, 0);
  const [k1, k2, k3] = m.kpis;
  return {
    kpis: { total_loss: { now: k1[2] * scale, before: k1[3] * scale }, loss_rate: { now: k2[2], before: k2[3] }, items: { now: Math.round(k3[2] * scale), before: Math.round(k3[3] * scale) } },
    charts: {
      loss_trend: { columns: [], rows: m.trend[2].map(([x, y]) => ({ x, y0: y * scale })), truncated: false },
      by_category: { columns: [], rows: cats.map(([x, y0]) => ({ x, y0 })), truncated: false },
      channel_mix: { columns: [], rows: m.trend[2].flatMap(([x, y], i) => series.map((s, j) => ({ x, s, y0: Math.round((y * scale * (series.length - j + (i % 2))) / (series.length * 2)) }))), truncated: false },
      pareto: { columns: [], rows: cats.map(([x, y0]) => ({ x, y0, total })), truncated: false },
    },
    tables: {},
    errors: {},
  };
}

function forecastPage(u, spec) {
  return {
    ...base(u, spec),
    story: `${u.story} The next weeks need {next_forecast} units; {at_risk_n} store-items carry a forecast error above the naive benchmark.`,
    kpis: byId(spec.kpis, { at_risk_n: { label: 'Store-items at risk' }, orders_open: { label: 'Orders to decide' } }),
    records: { ...spec.records, title: 'Store orders to place', hint: 'Store-items from the latest run, ranked by the stock at risk.' },
    plan: { ...spec.plan, title: 'Order plan', hint: 'The suggested order for each store-item from the forecast. Accept it, or override it with a reason.' },
    filters: filterText(spec, { category: ['Category'], region: ['Store'], channel: ['Channel'] }),
  };
}

function forecastRows(u) {
  return u.mvp.orders.map(([label, category, current, recommended, action, reasons], i) => ({
    record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(500 + i), entity_id: `I${i + 1}`, entity_label: label, category,
    region: label.split(' at ')[1], channel: 'Store', priority_tier: TIERS[Math.min(2, Math.floor(i / 2))], rank: i + 1,
    value: Math.abs(recommended - current) * 38, current_order: current, recommended_order: recommended, recommended_action: action, top_reasons: reasons, as_of_date: AS_OF,
  }));
}

function forecastData(u) {
  const weeks = WEEKS(20);
  const fan = weeks.map((x, i) => (i < 12 ? { x, y0: 8600 + i * 120 + (i % 4 === 3 ? 700 : 0), y1: null, y2: null, y3: null }
    : { x, y0: null, y1: 10100 + (i - 12) * 260, y2: 9400 + (i - 12) * 220, y3: 10800 + (i - 12) * 300 }));
  return {
    kpis: { next_forecast: { now: 84300 }, last_actual: { now: 116400 }, at_risk_n: { now: 14 }, orders_open: { now: u.mvp.orders.length } },
    charts: {
      fan: { columns: [], rows: fan, truncated: false },
      vs_capacity: { columns: [], rows: weeks.slice(12).map((x, i) => ({ x, y0: 10100 + i * 260, y1: 10800 + i * 300, y2: 11900 })), truncated: false },
      accuracy: { columns: [], rows: u.mvp.accuracy.map(([x, y0]) => ({ x, y0 })), truncated: false },
    },
    tables: { at_risk: { columns: [], rows: u.mvp.orders.slice(0, 4).map(([label, category, current, recommended]) => ({ series_label: label, category, backtest_mase: 0.7, next_forecast: recommended, upside: Math.round(recommended * 0.18) })), truncated: false } },
    errors: {},
  };
}

function plannerPage(u, spec) {
  const m = u.mvp;
  return {
    ...base(u, spec),
    story: `${u.story} The plan saves {objective}; {binding} limits are fully used.`,
    kpis: byId(spec.kpis, { objective: { label: m.objective[0] }, changed: { label: m.changed }, binding: { label: m.binding } }),
    records: { ...spec.records, title: 'Plan lines', hint: 'Lines in this week\'s plan, ranked by the saving they add.', sublabel: 'category' },
    plan: { ...spec.plan, title: 'This week\'s plan', hint: 'The current value of each line next to the solver\'s plan. Accept a line, or override it with a reason.' },
    filters: filterText(spec, { category: [m.category], region: ['Region'], channel: ['Channel'] }),
  };
}

function plannerRows(u) {
  return u.mvp.lines.map(([label, category, current, recommended, saving], i) => ({
    record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(600 + i), entity_id: label, entity_label: label, category, region: 'All', channel: 'All',
    priority_tier: TIERS[Math.min(2, Math.floor((i * 3) / u.mvp.lines.length))], rank: i + 1, value: saving, current_value: current, recommended_value: recommended,
    delta: recommended - current, objective_contribution: saving, recommended_action: recommended > current ? 'Raise to the plan' : 'Cut to the plan',
    top_reasons: [saving >= 0 ? `Saves $${Math.abs(saving).toLocaleString('en-US')}` : `Costs $${Math.abs(saving).toLocaleString('en-US')} to protect service`], as_of_date: AS_OF,
  }));
}

function plannerData(u) {
  const m = u.mvp;
  return {
    kpis: { objective: { now: m.objective[1] }, changed: { now: m.lines.length }, binding: { now: m.limits.filter(([, used, limit]) => used >= limit * 0.95).length } },
    charts: {
      limits_used: { columns: [], rows: m.limits.map(([x, y0, y1]) => ({ x, y0, y1 })), truncated: false },
      swing: { columns: [], rows: m.limits.map(([x, , limit, price]) => ({ x, y0: -0.1 * limit * price * 100, y1: 0.1 * limit * price * 100 })), truncated: false },
      worth: { columns: [], rows: m.limits.map(([x, , , y0]) => ({ x, y0 })), truncated: false },
    },
    tables: {},
    errors: {},
  };
}

function scenarioPage(u, spec) {
  const m = u.mvp;
  return {
    ...base(u, spec),
    story: `${u.story} The base case earns {base_p50} next quarter, with a {base_chance} chance of reaching the target.`,
    kpis: byId(spec.kpis, { base_chance: { label: 'Chance of the $4.0M target' }, last_margin: { label: 'Margin last quarter' } }),
    scenario: {
      ...spec.scenario, title: 'Move the levers', hint: 'Each lever moves up to 10% either way from the base case.',
      levers: m.levers.map(([lever, label]) => ({ lever, label, format: 'number', step: 1 })),
      outcome: { ...spec.scenario.outcome, label: 'Margin next quarter', target: m.target },
    },
  };
}

export function scenarioEvaluate(u, values = {}) {
  const m = u.mvp;
  const levers = m.levers.map(([lever, , k]) => ({ lever, base: 0, low: -10, high: 10, value: Math.max(-10, Math.min(10, Number(values[lever] ?? 0) || 0)), k }));
  const deltaOf = (l) => Math.round(l.k * 1000000 * l.value);
  const p50 = m.base + levers.reduce((s, l) => s + deltaOf(l), 0);
  const spread = m.sd * 1.28;
  const chance = 1 / (1 + Math.exp((-1.7 * (p50 - m.target)) / m.sd));
  return {
    levers: levers.map(({ k, ...l }) => l), clamped: [], contributions: levers.map((l) => ({ lever: l.lever, delta: deltaOf(l) })),
    distribution: Array.from({ length: 41 }, (_, i) => [Math.round(p50 - 2 * m.sd + (i * m.sd) / 10), Number(Math.exp(-0.5 * ((i - 20) / 10) ** 2).toFixed(4))]),
    outcome: { p10: Math.round(p50 - spread), p50: Math.round(p50), p90: Math.round(p50 + spread), prob_target: Number(chance.toFixed(2)), target: m.target },
  };
}

function scenarioRows(u) {
  return u.mvp.exposures.map(([label, region, value, action, reasons], i) => ({
    record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(700 + i), entity_id: label, entity_label: label, region, channel: 'All',
    priority_tier: TIERS[Math.min(2, Math.floor((i * 3) / u.mvp.exposures.length))], rank: i + 1, value, recommended_action: action, top_reasons: reasons, as_of_date: AS_OF,
  }));
}

function scenarioData(u) {
  const m = u.mvp;
  return {
    kpis: { base_p50: { now: m.base }, base_chance: { now: m.scenarios[0][4] }, last_margin: { now: 4050000, before: 3980000 } },
    charts: { swing: { columns: [], rows: [['Unit cost', 350000], ['Price', 450000], ['Volume', 200000]].map(([x, d]) => ({ x, y0: -d, y1: d })), truncated: false } },
    tables: { scenarios: { columns: [], rows: m.scenarios.map(([scenario_id, p50, p10, p90, prob_target]) => ({ scenario_id, p10, p50, p90, prob_target })), truncated: false } },
    errors: {},
  };
}

function segmentPage(u, spec) {
  const m = u.mvp;
  return {
    ...base(u, spec),
    story: `${u.story} {members} buyers fall into {segments} segments worth {value} a year.`,
    kpis: byId(spec.kpis, { members: { label: 'Buyers' }, value: { label: 'Yearly margin' } }),
    records: { ...spec.records, title: 'Buyers', hint: 'Buyers from the latest run, ranked by their yearly margin.' },
    segments: { ...spec.segments, treatments: m.treatments },
    filters: filterText(spec, { segment: ['Segment'], region: ['Region'], channel: ['Channel'] }),
  };
}

function segmentRows(u) {
  const segs = u.mvp.segments;
  return Array.from({ length: 15 }, (_, i) => {
    const [segment, label, , , treatment] = segs[i % segs.length];
    return {
      record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(700 + i), entity_id: `B${10400 + i * 37}`, entity_label: `Buyer ${10400 + i * 37}`,
      segment, segment_label: label, priority_tier: TIERS[i % 3], rank: i + 1, value: 5200 - i * 280, recommended_action: treatment,
      top_reasons: [label === 'Costly returners' ? 'Returns 38% of orders' : 'Orders often, big baskets'], region: ['North', 'South', 'East', 'West'][i % 4], channel: i % 2 ? 'Web' : 'Store', as_of_date: AS_OF,
    };
  });
}

function segmentData(u) {
  const m = u.mvp;
  return {
    kpis: { members: { now: m.buyers }, segments: { now: m.segments.length }, value: { now: m.margin } },
    charts: {
      profile: { columns: [], rows: m.axes.flatMap((x, f) => m.segments.map(([, s, , , , scores]) => ({ x, s, y0: scores[f] }))), truncated: false },
      map: { columns: [], rows: Array.from({ length: 40 }, (_, i) => ({ x_label: `Buyer ${10400 + i}`, x: Number((((i % 5) - 2) + (i % 3) * 0.3).toFixed(2)), y0: Number((((i % 4) - 1.5) + (i % 2) * 0.4).toFixed(2)) })), truncated: false },
      worth: { columns: [], rows: m.segments.map(([, x, share, margin]) => ({ x, y0: Math.round((m.buyers * share) / 100), y1: Math.round((m.margin * margin) / 100 / ((m.buyers * share) / 100)) })), truncated: false },
      moves: { columns: [], rows: [{ x: 'Loyal high value', s: 'Occasional', y0: 312 }, { x: 'Growing', s: 'Loyal high value', y0: 240 }, { x: 'Occasional', s: 'Price hunters', y0: 180 }, { x: 'Price hunters', s: 'Costly returners', y0: 90 }], truncated: false },
    },
    tables: { cards: { columns: [], rows: m.segments.map(([segment_id, label, share, margin, suggested_treatment]) => ({ segment_id, label, size: Math.round((m.buyers * share) / 100), value: Math.round((m.margin * margin) / 100 / ((m.buyers * share) / 100)), profile: `${share}% of buyers, ${margin}% of margin`, suggested_treatment })), truncated: false } },
    errors: {},
  };
}

function recsPage(u, spec) {
  return {
    ...base(u, spec),
    story: `${u.story} {offers} offers are ready for {customers} buyers, worth {worth} if they convert at the expected rate.`,
    kpis: byId(spec.kpis, { customers: { label: 'Loyal buyers' } }),
    records: { ...spec.records, title: 'Offers to send', hint: 'The next 3 offers for each loyal buyer from the latest run, best first.' },
    filters: filterText(spec, { item: ['Offer'], region: ['Region'], channel: ['Channel'], plan_type: ['Loyalty tier'] }),
  };
}

function recsRows(u) {
  return u.mvp.buyers.flatMap(([buyer, offers], c) => offers.map(([item, score, reason], k) => ({
    record_key: `K${c * 3 + k + 1}`, _inspire_key: `K${c * 3 + k + 1}`, _inspire_version: String(800 + c * 3 + k), entity_id: `${buyer}:${item}`, entity_label: item, item,
    customer_name: buyer, customer_id: buyer.replace('Buyer ', 'B'), priority_tier: 'Act now', rank: k + 1, score, value: Math.round(score * 90),
    recommended_action: k < 2 ? 'Send this offer' : 'Send if the first two do not convert', top_reasons: [reason], region: 'North', channel: 'Web', plan_type: 'Gold', as_of_date: AS_OF,
  })));
}

function recsData(u) {
  const items = u.mvp.buyers.flatMap(([, offers]) => offers.map(([item]) => item));
  return {
    kpis: { offers: { now: 19200 }, customers: { now: 6400 }, worth: { now: 900000 } },
    charts: {
      affinity: { columns: [], rows: items.slice(0, 6).flatMap((x, i) => ['Gold', 'Silver'].map((s, j) => ({ x, s, y0: Number((0.82 - i * 0.05 - j * 0.07).toFixed(2)) }))), truncated: false },
      lift: { columns: [], rows: u.mvp.categories.map(([x_label, lift], i) => ({ x_label, x: 3200 - i * 400, y0: lift })), truncated: false },
      coverage: { columns: [], rows: items.slice(0, 6).map((x, i) => ({ x, y0: 6400 - i * 700 })), truncated: false },
    },
    tables: {},
    errors: {},
  };
}

function liftPage(u, spec) {
  return {
    ...base(u, spec),
    story: `${u.story} Promotions added {incremental} in sales on {spend} of spend; {real} of them show a lift that is real.`,
    filters: filterText(spec, { channel: ['Channel'], promotion: ['Promotion'], region: ['Region'], category: ['Category'] }),
  };
}

function liftRows(u) {
  return u.mvp.promos.map(([label, net, , , effect, , roi, action, cost], i) => ({
    record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(900 + i), entity_id: label, entity_label: label, priority_tier: TIERS[Math.min(2, i)], rank: i + 1,
    value: net, effect, roi, incremental_value: net + cost, recommended_action: action, top_reasons: [net >= 0 ? `Net lift $${Math.round(net / 1000)}K after cost` : `Net loss $${Math.round(-net / 1000)}K after cannibalization`],
    channel: 'Store', region: 'All', category: 'All', as_of_date: AS_OF,
  }));
}

function liftData(u) {
  const promos = u.mvp.promos;
  const weeks = WEEKS(12, Date.UTC(2026, 2, 2));
  const added = promos.reduce((s, p) => s + Math.max(0, p[1] + p[8]), 0);
  const spend = promos.reduce((s, p) => s + p[8], 0);
  return {
    kpis: { incremental: { now: added }, spend: { now: spend }, real: { now: promos.filter((p) => p[5] <= 0.05).length } },
    charts: {
      versus: { columns: [], rows: weeks.map((x, i) => ({ x, y0: 410000 + i * 9000 + (i > 5 ? 60000 : 0), y1: 400000 + i * 8000, y2: 385000 + i * 8000, y3: 415000 + i * 8000 })), truncated: false },
      waterfall: { columns: [], rows: [{ x: 'Sales added', y0: added }, { x: 'Promotion cost', y0: -spend }, { x: 'Net added', y0: added - spend }], truncated: false },
      curves: { columns: [], rows: promos.map(([x_label, net, , , , , , , cost]) => ({ x_label, x: cost, y0: net + cost })), truncated: false },
    },
    tables: { effect: { columns: [], rows: promos.map(([intervention, net, lower, upper, effect, p_value, roi, , cost]) => ({ intervention, effect, lower: Math.round((effect * lower) / Math.max(1, Math.abs(net))), upper: Math.round((effect * upper) / Math.max(1, Math.abs(net))), p_value, roi, incremental_value: net + cost, cost })), truncated: false } },
    errors: {},
  };
}

const textOf = (list, changes) => list.map((item) => {
  const change = changes[item.id || item.column];
  if (!change) return item;
  const { y, ...rest } = change;
  return { ...item, ...rest, ...(y ? { y: item.y.map((one, i) => ({ ...one, label: y[i] ?? one.label })) } : {}) };
});

function processPage(u, spec) {
  return {
    ...base(u, spec),
    story: `${u.story} {open} orders are open now.`,
    kpis: byId(spec.kpis, { open: { label: 'Open orders' }, at_risk: { label: 'May miss the promised date' } }),
    charts: textOf(spec.charts, {
      map: { title: 'How orders move between steps', hint: 'Each arrow is a move: thicker means more orders, red means slow, dashed means sent back.',
        so_what: 'Click a step to list the orders waiting there, then move the ones at risk.', y: ['Orders'] },
      bottlenecks: { hint: 'Hours the slowest 1 in 10 orders spend before they leave each step.', so_what: 'The top step is where an extra hand saves the most time.' },
      rework: { title: 'Orders sent back', hint: 'Orders each step sent back to an earlier step.', so_what: 'A step that sends many orders back needs a clearer check upstream.', y: ['Orders sent back'] },
      cycle: { title: 'Age of open orders by path', hint: 'The box holds the middle half of the orders; the line in it is the median.',
        so_what: 'A path with a long box is unpredictable: promise it a later date.', x: { ...spec.charts.find((c) => c.id === 'cycle').x, label: 'Path' } },
    }),
    records: { ...spec.records, title: 'Open orders at risk', hint: 'Click a step on the process map to list the orders waiting there; the ★ choice follows the suggested action.',
      detail: textOf(spec.records.detail, { variant: { label: 'Path' }, region: { label: 'Warehouse' } }) },
    filters: filterText(spec, { variant: ['Path'], region: ['Warehouse'] }),
  };
}

function processRows(u) {
  return u.mvp.rows.map(([label, step, age_hours, breach_risk, action, reasons, variant, region], i) => ({
    record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(1100 + i), entity_id: label, entity_label: label, step, age_hours, breach_risk: breach_risk / 100,
    variant, region, priority_tier: TIERS[Math.min(2, Math.floor(i / 2))], rank: i + 1, value: Math.round(breach_risk * 40), recommended_action: action, top_reasons: reasons, as_of_date: AS_OF,
  }));
}

function processData(u, picked) {
  const m = u.mvp;
  const moves = m.moves.filter(([from]) => !picked?.step?.length || picked.step.includes(from));
  return {
    kpis: { open: { now: m.kpis.open }, at_risk: { now: m.kpis.at_risk }, age: { now: m.kpis.age } },
    charts: {
      map: { columns: [], rows: moves.map(([x, s, y0, y1]) => ({ x, s, y0, y1 })), truncated: false },
      bottlenecks: { columns: [], rows: moves.map(([x, , , , y0]) => ({ x, y0 })).sort((a, b) => b.y0 - a.y0), truncated: false },
      rework: { columns: [], rows: m.rework.map(([x, y0]) => ({ x, y0 })), truncated: false },
      cycle: { columns: [], rows: m.cycle.filter(([x]) => !picked?.variant?.length || picked.variant.includes(x)).map(([x, y0, y1, y2, y3, y4]) => ({ x, y0, y1, y2, y3, y4 })), truncated: false },
    },
    tables: {},
    errors: {},
  };
}

function locationPage(u, spec) {
  return {
    ...base(u, spec),
    story: `${u.story} {sites} candidate sites hold {demand} of unmet demand a year; {strong} of them are in the top band.`,
    kpis: byId(spec.kpis, { demand: { label: 'Unmet demand a year' } }),
    records: { ...spec.records, hint: 'Best first by net new sales; shortlist the ones to visit and reject the rest with a reason.' },
  };
}

function locationRows(u) {
  return u.mvp.sites.map(([id, name, code, , , metric, action, reasons, format], i) => ({
    record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(1200 + i), entity_id: id, entity_label: `${id} ${name}`, city: name.split(' ')[0],
    region_code: code, format, metric, priority_tier: TIERS[Math.min(2, Math.floor(i / 3))], rank: i + 1, value: metric, recommended_action: action, top_reasons: reasons, as_of_date: AS_OF,
  }));
}

function locationData(u, picked) {
  const sites = u.mvp.sites.filter(([id, , code, , , , , , format]) => (!picked?.country?.length || picked.country.includes(code))
    && (!picked?.site?.length || picked.site.includes(id)) && (!picked?.format?.length || picked.format.includes(format)));
  const byCountry = [...new Set(sites.map((s) => s[2]))].map((x) => ({ x, y0: sites.filter((s) => s[2] === x).reduce((t, s) => t + s[5], 0) }));
  return {
    kpis: { sites: { now: sites.length }, demand: { now: sites.reduce((t, s) => t + s[5], 0) }, strong: { now: sites.filter((s) => s[5] >= 1500000).length } },
    charts: {
      countries: { columns: [], rows: byCountry, truncated: false },
      points: { columns: [], rows: sites.map(([id, , , lat, lon, metric]) => ({ x: id, y0: metric, y1: lat, y2: lon })), truncated: false },
      density: { columns: [], rows: [...new Set(sites.map((s) => s[2]))].flatMap((x) => ['Large', 'Mid-size', 'Small'].map((s) => ({ x, s, y0: sites.filter((r) => r[2] === x && r[8] === s).length }))), truncated: false },
    },
    tables: { listed: { columns: [], rows: sites.map(([entity, name, region_code, , , metric]) => ({ entity, city: name.split(' ')[0], region_code, metric })), truncated: false } },
    errors: {},
  };
}

function networkPage(u, spec) {
  return {
    ...base(u, spec),
    story: `${u.story} {central} of the accounts are central to a ring.`,
    kpis: byId(spec.kpis, { rings: { label: 'Rings' } }),
    charts: textOf(spec.charts, { graph: { hint: 'Each color is a ring; a bigger dot has more shared links.', y: ['Shared links', 'Ring', 'Linked ring'] } }),
    records: { ...spec.records, title: 'Most central accounts', hint: 'Most central first; block the ring leaders, investigate the rest, or clear the ones that are not a ring.' },
    filters: filterText(spec, { ring: ['Ring'] }),
  };
}

function networkRows(u) {
  return u.mvp.accounts.map(([node, community, centrality, metric, action, reasons], i) => ({
    record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(1300 + i), entity_id: node, entity_label: node, node, community, centrality, metric,
    priority_tier: TIERS[Math.min(2, Math.floor(i / 4))], rank: i + 1, value: metric, recommended_action: action, top_reasons: reasons, as_of_date: AS_OF,
  }));
}

function networkData(u, picked) {
  const ring = Object.fromEntries(u.mvp.accounts.map(([node, community]) => [node, community]));
  const links = u.mvp.links.filter(([src]) => (!picked?.ring?.length || picked.ring.includes(ring[src])) && (!picked?.account?.length || picked.account.includes(src)))
    .map(([x, s, y0]) => ({ x, s, y0, y1: ring[x], y2: ring[s] }));
  return {
    kpis: { accounts: { now: u.mvp.kpis.accounts }, rings: { now: u.mvp.kpis.rings }, central: { now: u.mvp.kpis.central } },
    charts: { graph: { columns: [], rows: links, truncated: false } },
    tables: {
      neighbors: { columns: [], rows: links.slice(0, 4).map((l) => ({ src: l.x, dst: l.s, weight: l.y0, dst_community: l.y2 })), truncated: false },
      pairs: { columns: [], rows: [...links].sort((a, b) => b.y0 - a.y0).slice(0, 5).map((l) => ({ src: l.x, dst: l.s, weight: l.y0 })), truncated: false },
    },
    errors: {},
  };
}

function chatPage(u, spec) {
  return {
    ...base(u, spec),
    story: `${u.story} Genie answers from {rows} sales and stock rows across {accounts} items.`,
    kpis: byId(spec.kpis, { rows: { label: 'Sales and stock rows' }, accounts: { label: 'Items' }, net: { label: 'Net sales this quarter' } }),
    filters: filterText(spec, u.mvp.filters),
  };
}

function chatData(u) {
  const k = u.mvp.kpis;
  return { kpis: { rows: { now: k.rows }, accounts: { now: k.accounts }, net: { now: k.net } }, charts: {}, tables: {}, errors: {} };
}

const FILTERED = ['region', 'segment', 'channel'];
function kept(rows, picked) {
  const found = rows.filter((r) => FILTERED.every((k) => !picked?.[k]?.length || picked[k].includes(r[k])));
  return { found, scale: rows.length ? found.length / rows.length : 0 };
}
const kpiData = (kpis, scale, scaled) => Object.fromEntries(Object.entries(kpis).map(([id, [now, before]]) => {
  const s = scaled.includes(id) ? scale : 1;
  return [id, before === undefined ? { now: now * s } : { now: now * s, before: before * s }];
}));
const queueRow = (i, version, label, fields, action, reasons) => ({
  record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(version + i), entity_id: label, entity_label: label, ...fields,
  priority_tier: TIERS[Math.min(2, Math.floor(i / 2))], rank: i + 1, recommended_action: action, top_reasons: reasons, as_of_date: AS_OF,
});

function monitorPage(u, spec) {
  const m = u.mvp;
  return {
    ...base(u, spec), story: u.story,
    kpis: byId(spec.kpis, { exposure: { label: 'Billed above contract' }, anomalies: { label: 'Days outside the range' } }),
    charts: textOf(spec.charts, {
      signal: { title: 'Freight billed each day against the contract', hint: 'Expected and its range come from the contract rates and the shipped weight.',
        so_what: 'Days above the range are where the exceptions in the queue come from.', y: ['Billed', 'Expected', 'Low', 'High'] },
      by_rule: { hint: 'Open exceptions by the control test that raised them.', so_what: 'Fix the rate table behind the top rule and most of the queue clears.' },
      by_age: { so_what: 'Clear the oldest first: a carrier pays back less the longer an invoice waits.', y: ['Open exceptions', 'Above contract'] },
    }),
    records: { ...spec.records, title: m.records[0], hint: m.records[1], columns: textOf(spec.records.columns, { value: { label: 'Above contract' } }),
      detail: textOf(spec.records.detail, Object.fromEntries(FILTERED.map((id) => [id, { label: m.filters[id][0] }]))) },
    filters: filterText(spec, m.filters),
  };
}

const monitorRows = (u) => u.mvp.rows.map(([label, exception_rule, value, age_days, action, reasons, region, segment, channel], i) =>
  queueRow(i, 1300, label, { exception_rule, age_days, value, region, segment, channel }, action, reasons));

function monitorData(u, picked) {
  const m = u.mvp;
  const { scale } = kept(monitorRows(u), picked);
  return {
    kpis: kpiData(m.kpis, scale, ['open_n', 'exposure', 'old_n']),
    charts: {
      signal: { columns: [], rows: m.signal.map(([x, ...ys]) => ({ x, ...Object.fromEntries(ys.map((y, i) => [`y${i}`, Math.round(y * scale)])) })), truncated: false },
      by_rule: { columns: [], rows: m.rules.map(([x, y0]) => ({ x, y0: Math.round(y0 * scale) })), truncated: false },
      by_age: { columns: [], rows: m.ages.map(([x, y0, y1]) => ({ x, y0: Math.round(y0 * scale), y1: Math.round(y1 * scale) })), truncated: false },
    },
    tables: {},
    errors: {},
  };
}

function explainerPage(u, spec) {
  const m = u.mvp;
  const [title, xLabel, yLabel, hint] = m.peers;
  const peers = spec.charts.find((c) => c.id === 'vs_peers');
  const gaps = spec.tables.find((t) => t.id === 'peer_gaps');
  return {
    ...base(u, spec), story: u.story,
    kpis: byId(spec.kpis, Object.fromEntries(Object.entries(m.labels).map(([id, label]) => [id, { label }]))),
    charts: textOf(spec.charts, {
      walk: { title: m.walk[0], hint: `Each step adds up from ${m.walk[1][0].toLowerCase()} to ${m.walk[3][0].toLowerCase()}.` },
      vs_peers: { title, hint, x: { ...peers.x, label: xLabel }, y: [yLabel] },
    }),
    tables: textOf(spec.tables, {
      peer_gaps: { title: m.gaps[0], hint: `Each unit with its ${m.gaps[2].toLowerCase()} and its gap.`,
        columns: textOf(gaps.columns, { peer_group: { label: m.filters.segment[0] }, metric: { label: m.gaps[1] }, peer_median: { label: m.gaps[2] } }) },
    }),
    records: { ...spec.records, title: m.records[0], hint: m.records[1],
      columns: textOf(spec.records.columns, { actual: { label: m.labels.actual }, plan: { label: m.gaps[2] }, variance: { label: m.labels.variance } }),
      detail: textOf(spec.records.detail, { region: { label: m.filters.region[0] }, channel: { label: m.filters.channel[0] } }) },
    filters: filterText(spec, m.filters),
  };
}

const explainerRows = (u) => u.mvp.rows.map(([label, segment, variance, plan, action, reasons, region, channel], i) =>
  queueRow(i, 1400, label, { segment, region, channel, value: -variance, actual: plan + variance, plan, variance, tolerance: Math.round(plan * 0.03), period: '2026-10-01' }, action, reasons));

function explainerData(u, picked) {
  const m = u.mvp;
  const { found, scale } = kept(explainerRows(u), picked);
  const [, [start, from], steps, [end, to]] = m.walk;
  const walk = [[start, from * scale], ...steps.map(([x, v]) => [x, v * scale]), [end, to * scale]];
  return {
    kpis: { ...kpiData(m.kpis, scale, ['actual', 'plan', 'variance']), outside_n: { now: found.length, before: m.kpis.outside_n[1] } },
    charts: {
      walk: { columns: [], rows: walk.map(([x, y0]) => ({ x, y0: Math.round(y0) })), truncated: false },
      vs_peers: { columns: [], rows: found.map((r) => ({ x_label: r.entity_label, x: r.plan, y0: r.actual })), truncated: false },
      drivers: { columns: [], rows: [...steps].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([x, v]) => ({ x, y0: Math.round(Math.min(v, 0) * scale), y1: Math.round(Math.max(v, 0) * scale) })), truncated: false },
    },
    tables: {
      peer_gaps: { columns: [], rows: found.map((r) => ({ unit_label: r.entity_label, peer_group: r.segment, metric: r.channel, peer_median: r.plan, gap: r.variance })), truncated: false },
      said: { columns: [], rows: m.said.filter(([unit]) => found.some((r) => r.entity_label === unit)).map(([unit_label, reason, remark, author]) => ({ unit_label, reason, remark, author })), truncated: false },
    },
    errors: {},
  };
}

function dashboardPage(u, spec) {
  const m = u.mvp;
  const rows = spec.tables.find((t) => t.id === 'rows');
  const line = { entity_label: { label: 'Line' }, revenue: { label: 'Margin' }, prior_value: { label: 'Last month' } };
  return {
    ...base(u, spec), story: u.story,
    kpis: byId(spec.kpis, Object.fromEntries(Object.entries(m.labels).map(([id, label]) => [id, { label }]))),
    charts: textOf(spec.charts, {
      trend: { title: m.trend[0], hint: 'Monthly margin against the same month last year.', so_what: 'A gap that widens two months running is the trend to act on; ask Genie which driver moved it.', y: ['Margin', 'Last year'] },
      movers: { title: 'Lines that moved margin most', hint: 'Region and category lines with the largest change on last month.', so_what: 'Ask the owners of the top three lines what changed before the month closes.',
        x: { ...spec.charts.find((c) => c.id === 'movers').x, label: 'Line' }, y: ['Change in margin'] },
      by_region: { title: 'Margin by region', hint: 'Margin by region this month and last month.', so_what: 'A region that fell more than its share needs its own review.', y: ['This month', 'Last month'] },
    }),
    tables: textOf(spec.tables, { rows: { title: 'Lines behind the change', hint: 'Each line with its margin and its change on last month.', so_what: 'Sort by change to find the lines behind the movers chart.',
      columns: textOf(rows.columns, line) } }),
    filters: filterText(spec, m.filters),
  };
}

const dashboardLines = (u) => u.mvp.rows.map(([entity_label, region, segment, channel, change, prior_value]) =>
  ({ entity_label, region, segment, channel, revenue: prior_value + change, prior_value, change }));

function dashboardData(u, picked) {
  const m = u.mvp;
  const { found, scale } = kept(dashboardLines(u), picked);
  const regions = m.byRegion.filter(([x]) => !picked?.region?.length || picked.region.includes(x));
  return {
    kpis: { revenue: { now: m.kpis.revenue[0] * scale, before: m.kpis.revenue[1] * scale }, prior: { now: m.kpis.prior[0] * scale }, growth: { now: m.kpis.growth[0] } },
    charts: {
      trend: { columns: [], rows: m.trend[1].map(([x, y0], i) => ({ x, y0: Math.round(y0 * scale), y1: Math.round(m.trend[2][i][1] * scale) })), truncated: false },
      movers: { columns: [], rows: found.map(({ entity_label: x, change: y0 }) => ({ x, y0 })), truncated: false },
      by_region: { columns: [], rows: regions.map(([x, y0, y1]) => ({ x, y0, y1 })), truncated: false },
    },
    tables: { rows: { columns: [], rows: found, truncated: false } },
    errors: {},
  };
}

const LAYOUTS = {
  decision_queue: { page: decisionPage, rows: decisionRows, data: decisionData },
  monitor_triage: { page: monitorPage, rows: monitorRows, data: monitorData },
  performance_explainer: { page: explainerPage, rows: explainerRows, data: explainerData },
  dashboard: { page: dashboardPage, rows: () => [], data: dashboardData },
  forecast_cockpit: { page: forecastPage, rows: forecastRows, data: forecastData, plan: true },
  planner: { page: plannerPage, rows: plannerRows, data: plannerData, plan: true },
  scenario_lab: { page: scenarioPage, rows: scenarioRows, data: scenarioData },
  segment_explorer: { page: segmentPage, rows: segmentRows, data: segmentData },
  recommendation_desk: { page: recsPage, rows: recsRows, data: recsData },
  lift_readout: { page: liftPage, rows: liftRows, data: liftData },
  process_flow: { page: processPage, rows: processRows, data: processData },
  location_view: { page: locationPage, rows: locationRows, data: locationData },
  network_explorer: { page: networkPage, rows: networkRows, data: networkData },
  agent_chat: { page: chatPage, rows: () => [], data: chatData },
};

export function mvpPage(u) {
  const layout = LAYOUTS[u.mvp.layout];
  if (!layout) throw new Error(`the demo has no ${u.mvp.layout} layout`);
  const spec = exampleOf(u);
  return { ...layout.page(u, spec), datasets: spec.datasets, genie: mvpSettings(u).genie, genie_note: '' };
}

export const exampleName = (u) => path.relative(SHELL_DIR, exampleFile(u.mvp.layout));

export function mvpSettings(u) {
  return {
    title: u.title, subtitle: DOMAINS[u.no.slice(0, 3)], genie: { space_id: `01f0d${u.no.replace('-', '').toLowerCase()}`, title: u.title },
    admin: DEMO_OWNER, built_at: '2026-11-02T06:00:00Z',
    ...(LAYOUTS[u.mvp.layout]?.plan ? { options: { modify: false, replace_edits: false, decisions: true } } : {}),
  };
}

const dateFilter = { id: 'run_date', type: 'date_range', label: 'Run date', grain: 'month', default: '12m', low: '2025-12-01', high: AS_OF,
  presets: [{ id: '3m', label: 'Last 3 months', from: '2026-08-01', to: AS_OF }, { id: '12m', label: 'Last 12 months', from: '2025-12-01', to: AS_OF }, { id: 'all', label: 'All time', from: '2025-12-01', to: AS_OF }] };

function filterOptions(u, page, rows) {
  return page.filters.map((f) => {
    if (f.type === 'date_range') return { ...dateFilter, id: f.id, label: f.label, grain: f.grain || 'month' };
    const own = u.mvp.filters && u.mvp.filters[f.id] ? u.mvp.filters[f.id][1] : null;
    const seen = [...new Set(rows.map((r) => r[f.id] ?? r[Object.keys(f.columns || {}).length ? f.columns.records : f.id]).filter((v) => v != null && v !== '').map(String))];
    const fromSegments = f.id === 'segment' && u.mvp.segments ? u.mvp.segments.map(([id]) => id) : null;
    return { id: f.id, type: f.type, label: f.label, options: own || fromSegments || seen };
  });
}

export const FIRST_QUESTION = /^What should I do first on .+, and why\?$/;

const hashOf = (text) => [...String(text)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7).toString(36);

function answerFor(u, body, rows) {
  const question = String(body?.question || '').trim();
  const known = u.genie.find((x) => x.q === question);
  if (known) return { text: `${known.a}\n\n${DEMO_RECORDED}`, sql: known.sql };
  const top = FIRST_QUESTION.test(question) ? rows[0] : null;
  if (top) {
    const why = (top.top_reasons || []).join('; ');
    const said = [`Start with ${top.entity_label ?? top.record_key}${why ? `: ${why}` : ''}.`, top.recommended_action ? `Suggested: ${top.recommended_action}.` : '',
      'Then work down the list in order.', u.story].filter(Boolean).join(' ');
    return { text: `${said}\n\n${DEMO_RECORDED}`,
      sql: `SELECT * FROM ${DEMO_CATALOG}.${u.result} ORDER BY rank LIMIT 5` };
  }
  const about = body?.about || {};
  const row = rows.find((r) => r.record_key === about.recordKey);
  if (row) {
    return { text: `${row.entity_label}: ${(row.top_reasons || []).join('; ')}. Suggested: ${row.recommended_action}.\n\n${DEMO_RECORDED}`, sql: `SELECT * FROM ${DEMO_CATALOG}.${u.result} WHERE record_key = '${row.record_key}'` };
  }
  const title = String(body?.title || question || 'this view');
  return { text: `${title}: ${u.story}\n\n${DEMO_RECORDED}`, sql: '' };
}

function listed(rows, body) {
  const filters = body?.filters || {};
  const words = String(body?.search || '').toLowerCase();
  return rows
    .filter((r) => Object.entries(filters).every(([k, v]) => !Array.isArray(v) || !v.length || !(k in r) || v.map(String).includes(String(r[k]))))
    .filter((r) => !words || [r.entity_label, r.customer_name, r.record_key].some((v) => String(v ?? '').toLowerCase().includes(words)));
}

const WORK_DAYS = { today: ['2026-11-02', '2026-11-03'], week: ['2026-11-02', '2026-11-09'], month: ['2026-11-01', '2026-12-01'], all: [null, null] };
const NO_WORK = { worked: { fixed: 0, dismissed: 0, could_not: 0, assigned: 0, notes: 0, changes: 0, records: 0 }, active_hours: 0,
  money: { measured: { n: 0, money: null }, reported: { n: 0, money: null }, estimated: { n: 0, money: null } },
  close: { n: 0, median_hours: null }, best: null };

export function myWork(info, body) {
  const nextDay = (day) => new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const [start, end] = body.from ? [body.from, nextDay(body.to || body.from)] : WORK_DAYS[body.window] || WORK_DAYS.week;
  return { person: 'person@example.com', period: { window: body.from ? null : body.window || 'week', zone: 'UTC', today: AS_OF, start_day: start, end_day: end },
    pages: Object.fromEntries(info.pages.map((p) => [p.id, NO_WORK])), errors: {}, offset: body.offset || 0, size: 50, total: 0, activity: [] };
}

export function mvpApi(u, info, shared = {}) {
  const layout = LAYOUTS[u.mvp.layout];
  const page = info.pages[0];
  const rows = layout.rows(u);
  const answers = {};
  const freshness = { has_job: true, source: 'job', last_success: null, last_run: null, active: null, overdue: false, cadence_days: 7, data_through: AS_OF,
    can_refresh: false, reason: 'This is the demo, so nothing in it refreshes', run_url: '' };
  const routes = {
    ...Object.fromEntries(Object.entries(shared).map(([route, answer]) => [route, () => answer])),
    'GET app': () => info,
    'GET filters': () => ({ filters: filterOptions(u, page, rows) }),
    'GET defaults': () => ({ range: null, errors: {} }),
    'GET freshness': () => freshness,
    'POST page': (body) => layout.data(u, body?.filters || {}),
    'POST records': (body) => {
      const found = listed(rows, body);
      const offset = body?.offset || 0;
      const limit = body?.limit || 25;
      return { rows: found.slice(offset, offset + limit), total: found.length, offset, limit, actions: !!layout.plan, changes: false,
        summary: { open: found.length, done: 0, resolved: 0, left: 0, owners: [] }, errors: {} };
    },
    'POST scenario/evaluate': (body) => scenarioEvaluate(u, body?.values || {}),
    'POST my_work': (body) => myWork(info, body || {}),
    'POST genie/ask': (body) => {
      const id = `m${hashOf(JSON.stringify([body?.question || '', body?.about?.recordKey || '']))}`;
      answers[id] = answerFor(u, body, rows);
      return { conversation_id: `c${pageIdOf(u)}`, message_id: id };
    },
    'POST genie/explain': (body) => {
      const id = `x${hashOf(JSON.stringify(body || {}))}`;
      answers[id] = answerFor(u, body, rows);
      return { conversation_id: `c${pageIdOf(u)}`, message_id: id, question: String(body?.question || '') };
    },
    'GET genie/message': (_body, query) => {
      const answer = answers[query.get('message_id')];
      if (!answer) return [404, { error: 'no such message' }];
      return { state: 'done', text: answer.text, sql: answer.sql, columns: [], rows: [], truncated: false };
    },
  };
  return { routes, rows, page };
}

export const DEMO_LAYOUTS = Object.keys(LAYOUTS);
