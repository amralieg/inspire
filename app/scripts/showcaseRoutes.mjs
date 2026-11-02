export const DEMO_READS = {
  'GET /api/inspire/sessions': 'Review lists the demo run under Change run, and Start lists it with its Latest Run badge',
  'GET /api/inspire/portfolio': 'Review and Start show the totals across all runs',
  'GET /api/inspire/results': 'Review, Build and the use cases on Monitor read the results of the demo run',
  'GET /api/inspire/usecases': 'Review and Build read the use cases of the demo run, and the Start quick view lists them',
  'GET /api/inspire/feedback': 'Review reads the feedback on the use cases',
  'GET /api/inspire/implement/history': 'Review and Build read the MVP versions',
  'GET /api/inspire/implement/status': 'Build reads each use case with an MVP',
  'GET /api/inspire/implement/live': 'Build reads the live state of each MVP',
  'GET /api/inspire/implement/money': 'Build reads the money view of each MVP',
  'GET /api/inspire/implement/settings': 'Build shows the Settings panel of each MVP',
  'GET /api/inspire/implement/tables': 'Build shows the tables of each MVP in its Settings panel, read-only in the demo',
  'GET /api/inspire/implement/alerts': 'Build lists the alerts of each MVP on its Alert tab, read-only in the demo, or its empty state',
  'GET /api/inspire/session': 'Monitor reads the demo run',
  'GET /api/inspire/steps': 'Monitor lists the steps of the demo run',
};

export const DEMO_READS_WHEN = {
  'GET /api/workspace/export': 'Review and Build preview the notebook of a use case that has a notebook and no Genie instruction',
};

export const NOT_IN_DEMO = {
  'GET /api/defaults': 'the App reads its workspace settings when it starts, before the demo opens, and never with the demo header',
  'GET /api/showcase': 'this is the list of demos itself, read from the demo files the App carries',
  'GET /api/warehouses': 'setup, Settings and the Start MVP wizard pick a warehouse; the demo has no setup and no wizard',
  'GET /api/notebook': 'the App publishes its agent notebook when it starts and from setup, never inside the demo',
  'GET /api/catalogs': 'setup, Launch and the Start MVP wizard browse catalogs; none of them is part of the demo',
  'GET /api/catalogs/:p/schemas': 'setup, Launch and the Start MVP wizard browse schemas; none of them is part of the demo',
  'GET /api/tables/:p/:p': 'Launch browses tables to start a run; the demo starts no run',
  'GET /api/me': 'the Configure page reads who is signed in; the demo has no Configure page',
  'GET /api/dbc/info': 'the Configure page reads the agent notebook file; the demo has no Configure page',
  'GET /api/health': 'setup checks the App health before the demo can open',
  'GET /api/run/:p': 'Monitor and Launch follow a job run they started; the demo run started no job in this workspace',
  'GET /api/run/:p/output': 'the run status panel reads the output of a job run it started; the demo starts none',
  'GET /api/run/:p/cancel': 'Monitor asks whether you may stop a job run only while it follows one; the demo hands Monitor no run, so it offers no Stop',
  'GET /api/run/pages': 'the demo Run tab lists the MVP Apps the demo carries, never the deployed pages of this workspace',
  'GET /api/workspace/list': 'Review lists the files a run wrote only outside the demo; the demo hides the files panel',
  'GET /api/inspire/step-results': 'the demo run is complete, so Review reads its final results and never the results of a run still in progress',
  'GET /api/demo-data/templates': 'the App check script reads it from a live App to confirm the backend is current; no page of the demo calls it',
  'GET /api/inspire/implement/context': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/app-look': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/lakebase': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/merge-targets': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/columns': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/values': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/serving-endpoints': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/principals': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/output-check': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/preflight': 'the Start MVP wizard reads it; the demo offers no new build',
  'GET /api/inspire/implement/destinations': 'the Start MVP wizard reads it; the demo offers no new build',
  'POST /api/inspire/implement/readiness': 'the Start MVP wizard checks the tables of a new build; the demo offers no new build',
  'POST /api/inspire/implement/plan': 'the Start MVP wizard plans a new build; the demo offers no new build',
  'POST /api/inspire/implement/swaps': 'the Start MVP wizard and an editable tables panel look for other tables; the demo edits nothing',
};

export function routeOf(method, url) {
  return `${String(method || 'GET').toUpperCase()} ${new URL(url, 'http://showcase.invalid').pathname}`;
}

export function unrecorded(exchanges, wanted = DEMO_READS) {
  const seen = new Set(exchanges.filter((x) => Number.isInteger(x.status) && x.status < 300).map((x) => routeOf(x.method, x.url)));
  return Object.keys(wanted).filter((route) => !seen.has(route));
}
