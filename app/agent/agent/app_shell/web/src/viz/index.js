// REQ-541: the 14 visual blocks, by id. A focus step names one of these plus a bind of role -> column.
import Bridge from './Bridge.jsx';
import Strip from './Strip.jsx';
import Histogram from './Histogram.jsx';
import TrendBand from './TrendBand.jsx';
import RankedBars from './RankedBars.jsx';
import SmallMultiples from './SmallMultiples.jsx';
import ShareShift from './ShareShift.jsx';
import BeforeAfter from './BeforeAfter.jsx';
import Funnel from './Funnel.jsx';
import Network from './Network.jsx';
import MapPin from './MapPin.jsx';
import Gauge from './Gauge.jsx';
import Timeline from './Timeline.jsx';
import CohortCards from './CohortCards.jsx';

export const BLOCKS = {
  bridge: Bridge, strip: Strip, histogram: Histogram, trend_band: TrendBand, ranked_bars: RankedBars, small_multiples: SmallMultiples,
  share_shift: ShareShift, before_after: BeforeAfter, funnel: Funnel, network: Network, map_pin: MapPin, gauge: Gauge, timeline: Timeline, cohort_cards: CohortCards,
};
export { MOTIONS, MOTION_LEVELS } from './motion.js';
