# Chrome Web Store privacy fields

These are prepared answers for the actual 0.1.0 package, not saved console
state. Review them against the final package when uploading.

**Single purpose:** Let users supervise coding-agent sessions on their own Yep
Anywhere servers and find the sessions related to a GitHub issue, pull request
or Jira ticket beside the page they are reviewing.

| Permission | Justification |
| --- | --- |
| `sidePanel` | Display related coding-agent sessions beside the current browser tab. |
| `storage` | Save extension preferences and a local saved-host login mirror so the worker can resume the user's selected hosts on demand. Temporary tab/lookup state uses session storage. No credentials use Chrome sync. |
| `activeTab` | A toolbar click reads that tab's URL for an explicit issue/ticket lookup. No page content is injected or read. |
| Optional `https://*/*`, `http://*/*` | Users can run GitHub Enterprise or Jira at their own addresses. Access is requested for one selected site at runtime, to observe that site's issue/ticket URLs for automatic lookup and the badge. No site access is granted at install. |

**Remote code:** No. Application JavaScript, fonts, styles, the worker and side
panel are bundled. Servers supply application data over the encrypted relay;
that data is not extension code. HTML artifact previews are unavailable in this
release. No remotely hosted script or `eval` permission is requested.

**Data categories used:** Personally identifiable information (host/login
identifiers), authentication information (login/resume material), web history
(selected issue/ticket URLs), user activity (server actions), and website
content (session transcripts, prompts and displayed project information).
Select these categories conservatively: local use and user-directed server
processing are disclosed, even though there is no analytics collection.
Health, financial/payment, location and personal communications are not
separately collected by the extension. Users control arbitrary prompt content.

**Certifications:** Data is not sold or transferred for advertising; it is used
only for the extension's single purpose and is not used for creditworthiness or
lending decisions. User-selected hosts, their configured AI providers, and
optional GitHub/Jira metadata integrations are the operational destinations.
Do not characterize encrypted relay processing as an absence of all metadata.

**Privacy policy:** [Published repository policy](https://github.com/kzahel/yepanywhere/blob/main/docs/distribution/chrome-extension/privacy.md).

**Reviewer access:** Use the existing isolated Yep Anywhere evaluation server
and sample account, recorded privately in the dotfiles `machines/laptop/yep-review/README.md` runbook.
Put its relay username, SRP username/password and steps in the console's
restricted Test instructions field, never in this repository or the listing.
Explain how to open the app from the panel, add the supplied host, sign in,
view the sample project, and look up an indexed sample issue. A reviewer does
not need a paid provider account. Verify that host's availability before review
submission; do not offer the short-lived screenshot fixture as reviewer access.
