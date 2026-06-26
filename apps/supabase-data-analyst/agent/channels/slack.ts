import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

import { supabaseDataAnalystConfig } from "../lib/supabase-data-analyst-config.js";

export default slackChannel({
  credentials: connectSlackCredentials(supabaseDataAnalystConfig.slackConnectUid),
});
