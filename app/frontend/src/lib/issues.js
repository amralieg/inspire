export const INSPIRE_ISSUES_URL = 'https://github.com/amralieg/inspire/issues';
export const INSPIRE_NEW_ISSUE_URL = `${INSPIRE_ISSUES_URL}/new`;
export const newIssueUrl = (issue) => (issue?.title || issue?.body
  ? `${INSPIRE_NEW_ISSUE_URL}?${new URLSearchParams({ title: String(issue.title || ''), body: String(issue.body || '') }).toString()}`
  : INSPIRE_NEW_ISSUE_URL);
export const DIAGNOSTICS_PRIVACY_NOTE = 'This file holds no private or personal data: no data values, names, emails or workspace address, and table and column names are replaced by labels.';
export const REPORT_ISSUE_NOTE = 'The Inspire repo is public, so attach the downloaded file to the issue only after you read it.';
