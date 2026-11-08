import PlanSection from './PlanSection.jsx';
import PlanPerformance from './PlanPerformance.jsx';
import ReviewSection from './ReviewSection.jsx';
import AccuracyPanel from './AccuracyPanel.jsx';

export const PLAN_MODE = { work: { label: 'Plan', Component: PlanSection }, perf: { label: 'Performance', Component: PlanPerformance } };
export const FORECAST_MODE = { work: { label: 'Review', Component: ReviewSection }, perf: { label: 'Accuracy', Component: AccuracyPanel } };
