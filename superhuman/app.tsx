import { definePluginApp } from "@get-bb/plugin-sdk/app";
import registerArchiveButton from "./archive-button/app";
import registerHotkeys from "./hotkeys/app";
import registerPhoneLayout from "./phone-layout/app";
import registerSnooze from "./snooze/app";
import registerTitleBar from "./title-bar/app";
import registerUiPolish from "./ui-polish/app";
import registerUniversalSearch from "./universal-search/app";

// Each feature registers its own parts; ids stay unique across the plugin.
export default definePluginApp((app) => {
  registerHotkeys(app);
  registerUniversalSearch(app);
  registerSnooze(app);
  registerArchiveButton(app);
  registerUiPolish(app);
  registerPhoneLayout(app);
  registerTitleBar(app);
});
