#!/usr/bin/env node
// Writes installer/run_as_job_specs.json: the install-time job specs for run-as-me, built by the same functions the App
// uses per run (demoPipelineSpec, inspireJobEnvironments, inspireTaskCompute), so the installer and the App cannot drift.
// Placeholders: {{notebook.inspire}} / {{notebook.generate}} (filled by the installer) and {{job.parameters.<name>}}.
const fs = require('fs');
const path = require('path');
const { inspireJobEnvironments, inspireTaskCompute, RUN_AS_CONCURRENT_RUNS } = require('../backend/lib/inspireJobParams');
const { demoPipelineSpec, demoRunParameters } = require('../backend/lib/demoDataPipeline');

const OUT = path.join(__dirname, '..', 'installer', 'run_as_job_specs.json');
const param = (name) => `{{job.parameters.${name}}}`;

function buildRunAsJobSpecs() {
  const values = {
    description: param('description'), business: param('business_name'), catalog: param('inspire_catalog'),
    inspireDb: param('inspire_database'), sid: param('session_id'), demoSchema: param('demo_schema'),
    warehouse: param('warehouse_id'), appSp: param('app_sp_application_id'), plantKindSignals: param('plant_kind_signals'),
    discovery: 'Standard Discovery', generationPath: param('generation_path'),
  };
  const clusterSpec = inspireTaskCompute(null);
  const { tasks, inspireParams } = demoPipelineSpec(values, {
    generateNotebookPath: '{{notebook.generate}}', inspireNotebookPath: '{{notebook.inspire}}', clusterSpec,
  });
  // The discovery type is validated when the params are built, so the spec is built with a valid label and the key is then
  // pointed at its job parameter. demoPipelineSpec's base_parameters is the same object, so the tasks take the change.
  inspireParams['03_discovery_type'] = param('discovery_type');
  const names = Object.keys(demoRunParameters(values));
  return {
    format: 1,
    concurrent_runs: RUN_AS_CONCURRENT_RUNS,
    single_task: {
      tasks: [{ task_key: 'inspire_notebook', notebook_task: { notebook_path: '{{notebook.inspire}}', source: 'WORKSPACE', base_parameters: {} }, ...clusterSpec }],
      ...inspireJobEnvironments(null),
      max_concurrent_runs: RUN_AS_CONCURRENT_RUNS,
    },
    demo_pipeline: {
      parameters: names.map((name) => ({ name, default: '' })),
      tasks,
      ...inspireJobEnvironments(null),
      max_concurrent_runs: RUN_AS_CONCURRENT_RUNS,
    },
  };
}

module.exports = { buildRunAsJobSpecs, OUT };

if (require.main === module) {
  fs.writeFileSync(OUT, `${JSON.stringify(buildRunAsJobSpecs(), null, 2)}\n`, 'utf8');
  console.log(`wrote ${OUT}`);
}
