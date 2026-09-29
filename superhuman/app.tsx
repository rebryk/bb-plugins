import { definePluginApp } from "@get-bb/plugin-sdk/app";
import registerArchiveButton from "./archive-button/app";
import registerCodeCopy from "./code-copy/app";
import registerDiaSidebar from "./dia-sidebar/app";
import registerHaptics from "./haptics/app";
import registerHotkeys from "./hotkeys/app";
import registerPhoneLayout from "./phone-layout/app";
import registerServerSwitcher from "./server-switcher/app";
import registerSnooze from "./snooze/app";
import registerTerminalPaste from "./terminal-paste/app";
import registerThreadEta from "./thread-eta/app";
import registerThreadPrefetch from "./thread-prefetch/app";
import registerUiPolish from "./ui-polish/app";
import registerZoomLock from "./zoom-lock/app";

// Each feature registers its own parts; ids stay unique across the plugin.
export default definePluginApp((app) => {
  registerHotkeys(app);
  registerDiaSidebar(app);
  registerSnooze(app);
  registerArchiveButton(app);
  registerCodeCopy(app);
  registerTerminalPaste(app);
  registerServerSwitcher(app);
  registerZoomLock(app);
  registerPhoneLayout(app);
  registerHaptics(app);
  registerUiPolish(app);
  registerThreadPrefetch(app);
  registerThreadEta(app);
});
