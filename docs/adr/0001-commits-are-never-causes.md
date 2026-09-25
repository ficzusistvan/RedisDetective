# Commits are never Causes

Redis Detective names a **Cause** only from Redis evidence (a key pattern and what changed about
it). Git output is **Commit candidates** in the anomaly window or the **Commit lookback** before
it—optional context for a human, never ranked by plausibility or worded as the Cause. Listing may
group by timing (within the window, then before it) only for scanability. **Pattern hints**
(prefix matches in a message or path) are textual coincidence, not proof; hinted SHAs sit on the
explanation as `hintedCandidateShas`, beside the Cause, never inside it. The candidate window ends
at the anomaly window’s end: commits after growth are outside scope and are not listed for
rule-out. We walked this back from “name the commit that most plausibly introduced the change”
because we have no validated commit-attribution signal, and claiming one would repeat the
numeric-confidence trap. Rejected alternatives: keep aspirational “most plausible commit”
marketing while shipping honest candidates; build evidence rules that promote one candidate to a
Cause; or keep an after-anomaly rule-out list the live search never reliably returned.
