import { NOT_MEASURED } from './hub.js';
import { stakeName } from './format.js';
import { EMPTY, ageBars, alarmBars, backlogChart, flowChart, stakeBars, trendTiles } from './trends.js';
import { Icon } from './icons.jsx';
import { Tiles } from './Kpis.jsx';
import ChartCard, { BarsCard } from './ChartCard.jsx';

export default function TrendCards({ trends, impact, error, latest, page, app, themeKey, currency, kind, onFix, onRuns, onFeedback, onExplain, genieBusy }) {
  if (error) return <p className="tile-err" role="alert" data-trends-error><Icon name="info" size={14} />The trend cards could not load: {error}</p>;
  if (!trends) return <Tiles tiles={trendTiles(EMPTY, {})} loading label="Trends" fold="trends" />;
  if (!trends.actions) return null;
  const hue = page.hue || 'blue';
  const reason = trends.reason;
  const card = ({ chart, result }) => (
    <ChartCard key={chart.id} chart={chart} result={result} themeKey={themeKey} app={app} pageId={page.id} onExplain={onExplain} genieBusy={genieBusy} />
  );
  return (
    <section className="trends" aria-label="Trends" data-trends>
      <Tiles tiles={trendTiles(trends, { impact, latest, onFix, onRuns, onFeedback })} label="Trends" fold="trends" />
      <section className="charts">
        {card(backlogChart(trends))}
        {card(flowChart(trends))}
        <BarsCard id="trend_ages" title="Age of open records" hint="How long the open records have been on the list." hue={hue} bars={ageBars(trends, hue)}
          empty="Nothing is open." x="Age" measure="Open records" onExplain={onExplain} genieBusy={genieBusy}
          onFix={onFix ? () => onFix({ focus: 'older' }) : undefined} />
        {reason && (
          <BarsCard id="trend_stake" title={`${stakeName(currency, kind)}, by reason`} hint="Every open record, grouped by the reason the AI gives." hue={hue}
            bars={trends.money ? stakeBars(trends, hue, currency, kind) : []} empty={trends.money ? 'Nothing is open.' : NOT_MEASURED} x="Reason" measure="At stake"
            onExplain={onExplain} genieBusy={genieBusy} onFix={onFix && trends.money ? (value) => onFix({ reason: { name: reason, value }, money: true }) : undefined} />
        )}
        {reason && (
          <BarsCard id="trend_alarms" title="Not an issue, by reason" hint="The share of closed records marked Not an issue. A high share means the logic needs tuning."
            hue="amber" bars={alarmBars(trends, 'amber')} empty="Nothing is closed yet." x="Reason" measure="Not an issue (%)" onExplain={onExplain} genieBusy={genieBusy} />
        )}
      </section>
    </section>
  );
}

