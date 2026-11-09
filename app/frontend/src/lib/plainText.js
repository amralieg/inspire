import { FAILURE_CAUSES } from '../../../agent/agent/app_shell/web/src/failureCauses.js';
import { setFailureCauses } from '../../../agent/agent/app_shell/web/src/plainText.js';

setFailureCauses(FAILURE_CAUSES);

export {
  ASK_OWNER_APP_TEXT, ASK_OWNER_TEXT, COPIED_SEND_TEXT, COPY_SEND_LABEL, DETAILS_LABEL, RETRYING_LABEL, RETRY_LABEL, failureCauseOf, sendText, splitTechnical,
} from '../../../agent/agent/app_shell/web/src/plainText.js';
