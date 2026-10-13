See what waits for you in Slack from every BB thread, and open Slack beside
your work without leaving BB.

## A count in every thread

A Slack button in each thread's header shows your unread direct messages and
mentions, the same number as Slack's own badge. A dot means unread messages in
channels or threads you did not mute. The count updates every 20 seconds, on
your Mac and on your phone alike.

## Slack beside the thread

In the BB app, a click opens Slack in the thread's right panel, in BB's own
browser, which keeps you signed in. On a phone, it opens the Slack app.

## Set up once

The plugin reads the counts with your Slack session from a browser: its token
and its `d` cookie, which you paste into the plugin's settings. The README
shows where to find them. The BB server keeps them in a file only your user
can read and never sends them to a browser.

The counts come from the methods of Slack's web client rather than Slack's
public API, so a change at Slack can stop them until the plugin catches up.
