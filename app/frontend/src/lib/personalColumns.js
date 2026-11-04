export const PERSONAL_NAME_RE = new RegExp('(e[-_]?mail|phone|mobile|msisdn|fax|first[_-]?name|last[_-]?name|full[_-]?name|middle[_-]?name|surname|'
  + 'given[_-]?name|maiden|address|street|postcode|post[_-]?code|zip[_-]?code|zipcode|\\bssn\\b|social[_-]?security|'
  + 'national[_-]?id|tax[_-]?id|passport|licen[cs]e[_-]?(no|num|number)|iban|swift|account[_-]?(no|num|number)|'
  + 'card[_-]?(no|num|number)|credit[_-]?card|\\bcvv\\b|birth|\\bdob\\b|ip[_-]?addr|(^|_)ip($|_)|latitude|longitude|geo[_-]?loc)', 'i');
export const PERSONAL_TAG_RE = /pii|personal|sensitive|confidential|gdpr|hipaa|\bphi\b|\bpci\b|restricted/i;
export const PERSONAL_KEY_REASON = 'it holds personal or payment details (a card number, an email, a phone, an ID or account number), '
  + 'so it is never the key of the result: pick the id column of the entity instead';

export const TAGS_UNREAD_NOTE = 'Inspire could not read the Unity Catalog tags of this table, so only column names are checked for personal data';

const str = (v) => (v == null ? '' : String(v));

export function personalColumn(name, tags = {}) {
  if (PERSONAL_NAME_RE.test(str(name))) return true;
  return Object.entries(tags || {}).some(([tag, value]) => PERSONAL_TAG_RE.test(`${str(tag)} ${str(value)}`));
}
