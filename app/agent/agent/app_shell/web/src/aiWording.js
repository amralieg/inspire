// REQ-529c: text stored by older runs still names the retired product. What a person reads says Databricks AI; stored data and its keys are never changed.
// "Databricks " before the old name is absorbed so the sentence does not read "Databricks Databricks AI". Genie alone is a real product and stays.
const OLD_NAME = /(?:\bDatabricks[\s-]+)?\bgenie[\s-]code\b/gi;
export function aiWording(s) {
  return s == null ? '' : String(s).replace(OLD_NAME, 'Databricks AI');
}
