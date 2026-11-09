const RP = require('./routePolicy');

const LAUNCH_OPERATIONS = ['Discover Use Cases', 'Generate Use Cases'];
const IMPLEMENT_ONLY_PARAMS = ['inspire_implement_use_case', 'inspire_implement_spec_version', 'inspire_implement_run_id'];
const str = (v) => (v == null ? '' : String(v).trim());

function ownLaunch({ notebookPath, clusterId }, { notebooks = [], clusters = [], chooses = false } = {}) {
  const asked = str(notebookPath);
  const cluster = str(clusterId);
  if (chooses) return { notebookPath: asked, clusterId: cluster, warnings: [] };
  const own = notebooks.map(RP.canonicalPath).filter(Boolean);
  const notebookOk = !asked || own.includes(RP.canonicalPath(asked));
  const clusterOk = !cluster || clusters.map(str).filter(Boolean).includes(cluster);
  return {
    notebookPath: notebookOk ? asked : '',
    clusterId: clusterOk ? cluster : '',
    warnings: [
      ...(notebookOk ? [] : [`Inspire ran its own agent notebook, not ${asked}, because only an App manager can run another notebook as the App`]),
      ...(clusterOk ? [] : [`Inspire ran on serverless compute, not cluster ${cluster}, because only an App manager can pick a cluster for a run that runs as the App`]),
    ],
  };
}

function launchParamsProblem(params) {
  const values = params && typeof params === 'object' ? params : {};
  const operation = str(values['15_operation']);
  if (operation && !LAUNCH_OPERATIONS.includes(operation)) {
    return `Launch starts ${LAUNCH_OPERATIONS.join(' or ')} only; ${operation} starts from the Build page, which checks who owns the use case`;
  }
  const named = IMPLEMENT_ONLY_PARAMS.filter((key) => str(values[key]));
  if (named.length) return `Launch does not build a use case, so it takes no ${named.join(', ')}; build it from the Build page, which checks who owns it`;
  return '';
}

function sessionLaunchProblem(sessionId, { fresh, launcher, person, manager }) {
  if (!str(sessionId) || fresh || manager) return '';
  if (launcher && launcher === str(person).toLowerCase()) return '';
  const known = launcher ? `${launcher} launched it` : 'Inspire has no record of who launched it';
  return `Session ${str(sessionId)} already exists and ${known}, so only they or an App manager can run it again; launch a new session instead`;
}

module.exports = { LAUNCH_OPERATIONS, IMPLEMENT_ONLY_PARAMS, ownLaunch, launchParamsProblem, sessionLaunchProblem };
