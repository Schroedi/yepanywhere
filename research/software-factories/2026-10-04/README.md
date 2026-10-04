# AI Engineer software factories research

Collected October 4, 2026 from [AI Engineer](https://www.youtube.com/@aiDotEngineer/videos), the channel shown in the supplied screenshots. The central question is how software development changes when agents can carry work across planning, implementation, review, and operation.

Start with [Trends and discussion](trends.md). The collection contains five directly factory-focused talks and ten related talks, with original English automatic captions and readable timestamped transcripts.

## Scope and selection

The date window is **September 27 through October 4, 2026, inclusive**, using YouTube upload dates. This calendar-date interpretation includes the boundary-day uploads shown in the screenshots; it is not an exact rolling 168-hour filter. Upload dates are distinct from recording dates. These are conference recordings, and statements such as “this week” refer to the speaker's recording context, not necessarily the upload week.

The search enumerated the latest 50 entries on the channel's Videos tab and fetched individual metadata for the newest 42. Of those, 31 fall in the date window; the next entries are September 26 or earlier. All 31 were screened using titles and descriptions. Five explicitly address factories, and ten supply closely related evidence about development workflows, verification, coordination, or economics. This is not an exhaustive search for incidental spoken mentions across every upload. Shorts and the separate Live tab were not searched.

The five direct matches are all dated September 27. The selected related uploads extend through October 3. No directly factory-focused title was found among the October 4 uploads available at collection time.

## Five core talks

| Talk | Why read it | Transcript |
| --- | --- | --- |
| [Software Engineering Is Becoming Factory Engineering — Zach Lloyd, Warp](https://www.youtube.com/watch?v=tUPPVhBBcoM) | Lifecycle automation and the engineer's changing role | [Text](transcripts/tUPPVhBBcoM.txt) |
| [No, That's Not a Software Factory — Ryan Cooke, WorkOS](https://www.youtube.com/watch?v=HvboD89DyQ8) | Product outcomes and integration with organizational processes | [Text](transcripts/HvboD89DyQ8.txt) |
| [What It Actually Takes to Build a Software Factory — Tereza Tížková, Factory](https://www.youtube.com/watch?v=vGCJ7diEtrw) | Worker handoffs, validation contracts, context, and routing | [Text](transcripts/vGCJ7diEtrw.txt) |
| [Building Self-Improving Agent Software Factories — Suraj Gupta, Warp](https://www.youtube.com/watch?v=TN3mj92oZ8I) | Reviewed skill changes, persistent memory, and model selection | [Text](transcripts/TN3mj92oZ8I.txt) |
| [Orchestras, Not Factories — Charlie Holtz, Conductor](https://www.youtube.com/watch?v=TRfzFJCJ7ZE) | The counterargument: human craft and collaborative control | [Text](transcripts/TRfzFJCJ7ZE.txt) |

Suggested discussion order: Lloyd, Holtz, Cooke, Tížková, then Suraj Gupta. That establishes the thesis, challenges it, and then examines concrete mechanisms.

## Related talks

| Uploaded | Talk | Transcript |
| --- | --- | --- |
| Sep 27 | [Get Out of the Model's Way — Kevin Hou, Google Antigravity](https://www.youtube.com/watch?v=buHC7bQE1X4) | [Text](transcripts/buHC7bQE1X4.txt) |
| Sep 27 | [AI-Generated Code Is Already Competing With Human Code — Daksh Gupta, Greptile](https://www.youtube.com/watch?v=474j-n1Ltxc) | [Text](transcripts/474j-n1Ltxc.txt) |
| Sep 27 | [I Turned Coding Agents Into a Strategy Game — Ido Salomon, AgentCraft](https://www.youtube.com/watch?v=YIVkERhy8xo) | [Text](transcripts/YIVkERhy8xo.txt) |
| Sep 27 | [Scale the Judgment, Not the Model — Andrew Orobator, Reddit](https://www.youtube.com/watch?v=6MudaeKdBSk) | [Text](transcripts/6MudaeKdBSk.txt) |
| Sep 30 | [The Death of the Code Review — Laurie Voss, Arize AI](https://www.youtube.com/watch?v=_mi3alkqy4s) | [Text](transcripts/_mi3alkqy4s.txt) |
| Sep 30 | [Your Agents Are in Solitary Confinement — Vlad Luzin, Band](https://www.youtube.com/watch?v=UOcHfR3_tys) | [Text](transcripts/UOcHfR3_tys.txt) |
| Sep 30 | [The State of AI in Software Development — Justin Reock, DX](https://www.youtube.com/watch?v=Se8jHLliLXE) | [Text](transcripts/Se8jHLliLXE.txt) |
| Oct 2 | [Why AI Didn't Actually Make You Ship Faster — Gabriel Spencer-Harper, Meticulous](https://www.youtube.com/watch?v=HLTa7Vcs4X0) | [Text](transcripts/HLTa7Vcs4X0.txt) |
| Oct 2 | [Stop Rationing Tokens — Kimchi by Cast AI](https://www.youtube.com/watch?v=48YUYDjwfYY) | [Text](transcripts/48YUYDjwfYY.txt) |
| Oct 3 | [How VS Code Went from Monthly to Weekly Releases with AI — Harald Kirschner](https://www.youtube.com/watch?v=I2LL_wd89-A) | [Text](transcripts/I2LL_wd89-A.txt) |

## Files and provenance

- `transcripts/<video-id>.en-orig.json3`: captions downloaded directly from YouTube, preserving timing and segment data.
- `transcripts/<video-id>.txt`: the same caption text with whitespace normalized and adjacent cues grouped into approximately 20-second paragraphs. Paragraph timestamps identify the first cue. Spelling, filler, and transcription errors are retained; these are not editorially corrected transcripts.
- `metadata/<video-id>.json`: selected fields from YouTube extraction, including title, channel identity, upload timestamp/date, duration, description, chapter markers, and available caption languages. Older entries document the date boundary.
- `metadata/channel-scan.json`: the 50-entry discovery snapshot.
- [Source catalogue](sources.tsv): all 42 dated entries, their selection status, and the reason for inclusion or exclusion.
- [Selected sources](sources.json): machine-readable provenance and caption coverage for the 15 downloaded talks.
- [Selected URLs](selected-urls.txt): download input for reproducing the collection.
- [File checksums](SHA256SUMS): integrity hashes for the collection files, excluding the checksum file itself.

Automatic captions can misrecognize product names, people, and numbers. Audio and slides were not independently reviewed. Some description chapter markers differ from caption timing; discussion links use caption-derived approximate timestamps. Reported statistics and product capabilities are attributed to speakers, not independently audited. All speakers' commercial affiliations remain visible in the index.

## Retrieval

The existing `yt-dlp` installation (2026.06.09) retrieved public metadata and captions without browser cookies or account credentials. No video or audio was downloaded. The first request also asked for a redundant `en` track and hit HTTP 429 after successfully saving `en-orig`. Subsequent requests used only `en-orig`, with five seconds between caption requests; all selected original-English caption downloads succeeded.

From this directory, the caption retrieval can be repeated with:

```bash
yt-dlp --no-update --ignore-errors --skip-download --write-auto-subs \
  --sub-langs en-orig --sub-format json3 --no-progress --sleep-subtitles 5 \
  -o 'transcripts/%(id)s.%(ext)s' --batch-file selected-urls.txt
```

Text conversion concatenates each event's `segs[].utf8`, decodes HTML entities, skips whitespace-only events, and groups successive nonempty events until at least 20 seconds have elapsed from a paragraph's first event. Raw caption files remain the authoritative downloaded record. Captions cover speech, not silent portions of the recording.

Repository checks found no existing software-factory task or gap matching this research. The existing roadmap was read; this collection does not propose or reprioritize product work. No application source was changed.
