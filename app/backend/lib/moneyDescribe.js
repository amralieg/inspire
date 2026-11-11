const { parseExactJson } = require('./exactJson');
const { valueProblems } = require('./moneyRule');
const { replyContent } = require('./appFeedback');
const { compileExpression } = require('../../agent/agent/app_shell/web/src/moneyValue.js');

const DESCRIBE_MAX_CHARS = 600;
const COLUMN_LIMIT = 200;

function describeMessages({ text, columns, currencyColumn }) {
  const system = [
    'You turn one business description of how a record is worth money into one value rule for a data table.',
    'The user directive in the description WINS without exception over any guidance you were given.',
    'Answer with one JSON object and nothing else:',
    '{"explanation": "one plain sentence", "value": {"method": "fixed" | "column" | "equation", "amount": number, "column": "name", "expression": "name * name - name", "currency": "ISO code", "currency_column": "name"}}',
    'Use method fixed with amount for a flat amount per record; method column with column for an amount already in the table; method equation with expression for a value worked out from columns.',
    'The expression uses only the listed column names, numbers, + - * / and brackets.',
    'Give exactly one of currency (a three-letter code) or currency_column (a listed column).',
  ].join('\n');
  const user = [
    `Columns of the table: ${columns.join(', ')}`,
    currencyColumn ? `The currency column is ${currencyColumn}.` : 'The table has no currency column.',
    `Description: ${text}`,
  ].join('\n');
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

function namesIn(value) {
  if (value.method === 'column') return [value.column];
  if (value.method === 'equation') return (compileExpression(value.expression).columns || []);
  return [];
}

function parseDescription(data, columns) {
  const raw = replyContent(data).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let got;
  try {
    got = parseExactJson(raw);
  } catch {
    return { value: null, explanation: '', problems: ['the model did not answer with the JSON value rule, so there is no rule to show; describe it again'] };
  }
  const value = got && typeof got === 'object' && got.value && typeof got.value === 'object' ? got.value : got;
  const explanation = String(got?.explanation ?? '').trim().slice(0, 300);
  const problems = valueProblems(value);
  if (!problems.length) {
    const known = new Set(columns);
    for (const name of [...namesIn(value), ...(value.currency_column ? [value.currency_column] : [])]) {
      if (!known.has(name)) problems.push(`the rule uses ${name}, which is not a column of this table`);
    }
  }
  return { value: problems.length ? null : value, explanation, problems };
}

module.exports = { describeMessages, parseDescription, DESCRIBE_MAX_CHARS, COLUMN_LIMIT };
