'use strict';
// D-aws-03: a Generate run for several use cases failed 400 on v1.6.0. The live Jobs API refused the tag value "N10-U29,N12-U03":
// "The value must match the regular expression ^[\d \w\+\-=\.:/@]*$". A comma is not a job tag value character; a space is.
const test = require('node:test');
const assert = require('node:assert/strict');
const { inspireJobTags, inspireTagList, inspireTagListItems, resourceTagValue } = require('../lib/inspireJobParams');

const LIVE_JOB_TAG_VALUE = /^[\d \w+\-=.:/@]*$/;

test('a run for several use cases carries a use case id tag the Jobs API accepts, and the readers get every id back', () => {
  const ids = ['N10-U29', 'N12-U03', 'N13-U05'];
  const tags = inspireJobTags({ runType: 'genie_code', params: { '14_session_id': '100000000000000042' }, useCaseIds: ids });
  for (const [key, value] of Object.entries(tags)) assert.match(String(value), LIVE_JOB_TAG_VALUE, `${key}=${value}`);
  assert.deepEqual(inspireTagListItems(tags.dbx_inspire_ai_usecase_id), ids);
  assert.deepEqual(inspireTagListItems(inspireTagList(ids)), ids);
});

test('the job tag rule never lets a comma through', () => {
  assert.match(resourceTagValue('job', 'genie,agent_endpoint'), LIVE_JOB_TAG_VALUE);
});
