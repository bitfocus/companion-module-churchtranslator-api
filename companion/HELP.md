# ChurchTranslator.AI

Run live sermon translation from the booth: start and stop the service,
pause translation, and set the language the speaker is preaching in — with
the buttons lit from the real state of the service.

This module talks to your own ChurchTranslator.AI church. You need an
account at [churchtranslator.ai](https://churchtranslator.ai) and a capture
token.

## Setting it up

1. In the ChurchTranslator.AI dashboard, open **Connected devices → Booth
   control** and click **Mint a "Booth Stream Deck" token**. Use a dedicated
   token so you can revoke the deck without touching the computers that
   stream audio.
2. In Companion, add the **ChurchTranslator.AI** connection and fill in:

   | Field          | Value                                                                             |
   | -------------- | --------------------------------------------------------------------------------- |
   | Server URL     | From the Booth control card — `https://api.churchtranslator.ai` for most churches |
   | Capture token  | The token you just minted                                                         |
   | Session name   | `Sunday` unless support told you otherwise                                        |
   | Status refresh | How often to poll, in seconds (default 3)                                         |

3. Open **Presets → ChurchTranslator.AI** and drag the buttons you want onto
   your pages. The language buttons are generated from the languages your
   church actually uses, so there is nothing to delete.

If the connection turns red with _"Capture token rejected"_, the token was
revoked — mint a new one on the same dashboard card.

## Actions

| Action                 | What it does                                                                                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Start service          | Tells listeners to expect audio and asks your capture app to start streaming — it picks this up within a few seconds if it is open and signed in.                                                                |
| Pause translation      | Mutes translation. Listeners stay connected and billing stops.                                                                                                                                                   |
| Resume translation     | Unmutes.                                                                                                                                                                                                         |
| Toggle pause / resume  | One button for both, driven by the live state.                                                                                                                                                                   |
| Stop service           | Ends the service; the capture app stops streaming.                                                                                                                                                               |
| Set speaker's language | The language being preached, from a dropdown your server fills in. Tick "Switch the running service now" to change a service already streaming (a few seconds' pause); otherwise it applies to the next service. |
| Refresh status now     | Forces an immediate poll. Rarely needed.                                                                                                                                                                         |

The language dropdown supports Companion's expression mode, so it can be
driven from a variable or trigger without a separate action.

## Feedbacks

- **Service is live** — a capture app is streaming and translation is not paused.
- **Service is starting** — Start was pressed and the capture app hasn't picked
  it up yet (it collects the command on its own poll, within a few seconds).
  If nothing collects it, this clears rather than pretending the service began.
- **Translation paused** — streaming, but muted.
- **Listeners connected** — at least N phones are listening.
- **Speaker's language is** — lights the language button that is currently active.
- **Schedule wants a different language** — your service schedule would switch
  the speaker language for a session starting now, but the current setting is
  something else. Useful as a check before a bilingual Sunday.
- **Language in trouble**, **Input alarm (NO SOUND / NO FEED)** and **Input
  level meter** — the health read-out, below.

## Variables

`status`, `running`, `paused`, `starting`, `listeners`, `source_language`,
`source_language_label`, `scheduled_source_language`, `engine`,
`languages_translating`, `last_error`.

Companion prefixes variables with **your connection's label**, not a fixed
name. If you name the connection `ct`, you write `$(ct:status)`; if you name
it `Woodmark`, you write `$(Woodmark:status)`. Presets you drag in are
rewritten to your label automatically.

## Health read-out

The deck can also say how the service is _doing_, not just whether it is on.
Problems are shown by exception: a healthy deck looks the same every Sunday,
so the one button that changes colour is the one to look at.

- **Language buttons** (from the presets) show that language's listener count
  as their second line — phones on the cloud plus phones on the Local Wi-Fi
  relay. They turn **amber** while that language's translation is stalled and
  **red** when no translation engine can serve it (feedback: _Language in
  trouble_).
- **Input meter** — a display key to put next to START. While the service is
  live it shows the time on air and a 10-segment level meter in OBS's colours
  (green below −20 dBFS, yellow to −9, red above, 2-second peak hold). The
  level is what the **server** receives, so a moving bar proves the whole path
  from the mixer to the cloud. It turns red with **NO SOUND** when audio keeps
  arriving but has been silent for 15 s (aux send down, wrong input picked),
  and **NO FEED** when the capture app is connected but its audio stopped
  arriving. Paused is never an alarm.
- **Variables**: `total_listeners`, `on_air` (`42:13`, blank when not live),
  `input_peak_db`, `input_state` (`live` / `paused` / `off` / `nosound` /
  `nofeed` / `unknown`), and for each of your languages `listeners_<code>` and
  `health_<code>` (`translating` / `idle` / `stalled` / `unavailable`) — e.g.
  `$(ct:listeners_ru)`.

The meter moves ten times a second over a WebSocket that is opened only while
a service is live, not paused, and an _Input level meter_ feedback is on a
button. If that connection is blocked, the meter still moves at the status
refresh rate.

Against a ChurchTranslator.AI server older than the read-out (before
2026-10-02) none of this appears: the variables are not created, the presets
are the earlier ones, and no WebSocket is opened.

## The one thing worth knowing about language buttons

The translation engine takes the speaker's language when it opens its
connections at the start of a service, and it cannot be re-pointed
mid-stream. So:

- Pressing a language button **between services** applies to the next
  service. This is the normal use, and how a bilingual church runs a Russian
  9am and an English 11am.
- Pressing one **mid-sermon** changes the setting, but _this_ service keeps
  the language it started with. The module logs a warning when that happens
  rather than letting you believe it switched.

If your services always run in the same order, you can skip the buttons
entirely: set the speaker language per service under **Service schedules** in
the dashboard, and the server switches it when capture starts.

## Older servers

Speaker-language support was added to ChurchTranslator.AI after
start/pause/stop. Against a server that predates it, this module logs one
warning, keeps the connection green, and everything except the language
buttons works normally.

## Support

[help@churchtranslator.ai](mailto:help@churchtranslator.ai)
