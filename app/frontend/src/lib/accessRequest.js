// REQ-311: Request for Access from the Permission Required dialog. The check reads the destinations once per dialog; the send files the
// requests as the signed-in person (and for each grantee the backend resolves). Both pass the dialog's GRANT statements.
import { makeApiPostJson } from './apiClient.js';
export { offerShown, accessRequestResultText, statementsOf } from './accessRequestText.js';

const post = makeApiPostJson({});

// raise: false keeps a refusal on the caller's side, so the dialog shows its own plain reason and never opens over itself.
export const checkAccessRequest = (statements) => post('/api/access-request/check', { statements }, { raise: false });
export const sendAccessRequest = (statements) => post('/api/access-request', { statements }, { raise: false });

// REQ-521: one request for every picked object ({type: CATALOG|SCHEMA|TABLE, full_name}); the server knows who asks.
export const requestAccessFor = (objects) => post('/api/access-request', { objects }, { raise: false });
