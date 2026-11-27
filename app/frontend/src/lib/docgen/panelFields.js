// REQ-561: the side panel's fields, split once. The PDF card, the PPTX card slide and the infographic tile print the business list and never the technical one.
// `panels` are the titles the panel shows (UseCaseDetailBody.jsx, UseCaseStrategyDetail.jsx); `key` is the field of the agent card view.
export const PANEL_BUSINESS = [
  { key: 'what_you_get', panels: ['What you get'] },
  { key: 'statement', panels: ['Problem Statement'] },
  { key: 'solution', panels: ['Proposed Solution'] },
  { key: 'business_value', panels: ['Business Value'] },
  { key: 'strategy', panels: ['Strategy'] },
  { key: 'best_of_best', panels: ['Best of Best', 'Not starred as Best of Best'] },
  { key: 'kpis', panels: ['KPIs'] },
  { key: 'value_estimate', panels: ['Value estimate'] },
  { key: 'expected_key_results', panels: ['Expected key results'] },
  { key: 'measures_of_success', panels: ['Measures of success'] },
  { key: 'financial_benefits', panels: ['Financial benefits'] },
  { key: 'non_financial_benefits', panels: ['Non-financial benefits'] },
  { key: 'beneficiary', panels: ['Beneficiary'] },
  { key: 'sponsor', panels: ['Sponsor'] },
  { key: 'quality', panels: ['Quality'] },
  { key: 'business_priority_alignment', panels: ['Priority Alignment'] },
];

// Never printed on a use case page, slide or tile: tables, filters, SQL, notebook paths, foundations, KPI queries.
export const PANEL_TECHNICAL = ['Data Filters', 'Data evidence', 'Data foundations', 'Tables', 'SQL Implementation', 'Databricks AI Instruction', 'Use case notebook'];
